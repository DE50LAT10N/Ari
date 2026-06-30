import type { InitiativeSignalBundle } from "./initiativeContext";
import type { ProactiveSignalFact } from "./proactiveLlmEngine";

export type ProactiveTopicRelation =
  | "same_file"
  | "answers_question"
  | "blocks_task"
  | "researched"
  | "continues";

export type ProactiveTopicLink = {
  fromFactId: string;
  toFactId: string;
  relation: ProactiveTopicRelation;
  label: string;
  strength: number;
};

export type ProactiveTopicChain = {
  links: ProactiveTopicLink[];
  headFactId: string;
  summarySeed: string;
};

function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 3);
}

function sharedTokenCount(a: string, b: string): number {
  const wordsA = significantTokens(a);
  const wordsB = new Set(significantTokens(b));
  return wordsA.filter((word) => wordsB.has(word)).length;
}

function factById(facts: ProactiveSignalFact[], id: string): ProactiveSignalFact | undefined {
  return facts.find((fact) => fact.id === id);
}

function findFacts(facts: ProactiveSignalFact[], kind: ProactiveSignalFact["kind"]): ProactiveSignalFact[] {
  return facts.filter((fact) => fact.kind === kind);
}

function findFactsByIdPrefix(facts: ProactiveSignalFact[], prefix: string): ProactiveSignalFact[] {
  return facts.filter((fact) => fact.id.startsWith(prefix));
}

export function buildFactLinkGraph(
  facts: ProactiveSignalFact[],
  bundle: InitiativeSignalBundle,
): ProactiveTopicLink[] {
  const links: ProactiveTopicLink[] = [];
  const seen = new Set<string>();
  const push = (link: ProactiveTopicLink) => {
    const key = `${link.fromFactId}::${link.toFactId}::${link.relation}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    links.push(link);
  };

  const fileFact = findFacts(facts, "file")[0];
  const clipFact = findFacts(facts, "clipboard")[0];
  const chatFact = findFacts(facts, "chat")[0];
  const urgencyFact = findFacts(facts, "urgency")[0];
  const taskFacts = findFactsByIdPrefix(facts, "task:");

  if (clipFact && fileFact) {
    const fileName = fileFact.detail.toLowerCase();
    if (fileName && clipFact.detail.toLowerCase().includes(fileName.split(/[/\\]/).pop() ?? fileName)) {
      push({
        fromFactId: clipFact.id,
        toFactId: fileFact.id,
        relation: "same_file",
        label: "ошибка или фрагмент из буфера относится к текущему файлу в IDE",
        strength: 0.9,
      });
    }
  }

  if (chatFact) {
    for (const target of [clipFact, fileFact, ...findFacts(facts, "query")].filter(Boolean) as ProactiveSignalFact[]) {
      if (sharedTokenCount(chatFact.detail, target.detail) >= 2) {
        push({
          fromFactId: chatFact.id,
          toFactId: target.id,
          relation: "answers_question",
          label: `вопрос в чате связан с ${target.label.toLowerCase()}`,
          strength: 0.85,
        });
      }
    }
  }

  if (urgencyFact) {
    for (const target of [fileFact, ...taskFacts].filter(Boolean) as ProactiveSignalFact[]) {
      if (
        urgencyFact.detail.toLowerCase().includes("застрял") ||
        bundle.advisor.stuckScore >= 0.45
      ) {
        push({
          fromFactId: urgencyFact.id,
          toFactId: target.id,
          relation: "blocks_task",
          label: "застревание на работе связано с текущей задачей или файлом",
          strength: 0.8,
        });
      }
    }
  }

  for (const queryFact of findFacts(facts, "query")) {
    if (!queryFact.id.includes("browser") && !queryFact.detail) {
      continue;
    }
    for (const target of [fileFact, clipFact].filter(Boolean) as ProactiveSignalFact[]) {
      if (sharedTokenCount(queryFact.detail, target.detail) >= 1) {
        push({
          fromFactId: queryFact.id,
          toFactId: target.id,
          relation: "researched",
          label: `поиск «${queryFact.detail.slice(0, 40)}» связан с текущей работой`,
          strength: 0.75,
        });
      }
    }
  }

  for (const wmFact of findFacts(facts, "wm")) {
    if (wmFact.detail.includes("chat_question") || wmFact.detail.includes("вопрос")) {
      if (clipFact) {
        push({
          fromFactId: wmFact.id,
          toFactId: clipFact.id,
          relation: "continues",
          label: "недавний вопрос продолжается через свежий фрагмент в буфере",
          strength: 0.7,
        });
      }
    }
  }

  if (!links.length && fileFact && clipFact) {
    push({
      fromFactId: clipFact.id,
      toFactId: fileFact.id,
      relation: "same_file",
      label: "буфер и файл в IDE — общий контекст отладки",
      strength: 0.55,
    });
  }

  return links.sort((left, right) => right.strength - left.strength);
}

function buildChainSummary(links: ProactiveTopicLink[], facts: ProactiveSignalFact[]): string {
  if (!links.length) {
    return facts.slice(0, 2).map((fact) => fact.detail).join(" · ");
  }
  const parts = links.map((link) => {
    const from = factById(facts, link.fromFactId);
    const to = factById(facts, link.toFactId);
    const fromBit = from?.detail.slice(0, 50) ?? link.fromFactId;
    const toBit = to?.detail.slice(0, 50) ?? link.toFactId;
    return `${fromBit} → ${toBit}`;
  });
  return parts.join("; ");
}

export function inferTopicChains(
  links: ProactiveTopicLink[],
  facts: ProactiveSignalFact[],
  maxChains = 2,
): ProactiveTopicChain[] {
  if (!links.length) {
    if (facts.length >= 2) {
      return [
        {
          links: [],
          headFactId: facts[0].id,
          summarySeed: facts
            .slice(0, 2)
            .map((fact) => `${fact.label}: ${fact.detail.slice(0, 60)}`)
            .join(" · "),
        },
      ];
    }
    if (facts.length === 1) {
      return [
        {
          links: [],
          headFactId: facts[0].id,
          summarySeed: `${facts[0].label}: ${facts[0].detail.slice(0, 80)}`,
        },
      ];
    }
    return [];
  }

  const chains: ProactiveTopicChain[] = [];
  const used = new Set<string>();

  for (const link of links) {
    if (chains.length >= maxChains) {
      break;
    }
    if (used.has(link.fromFactId) && used.has(link.toFactId)) {
      continue;
    }
    chains.push({
      links: [link],
      headFactId: link.fromFactId,
      summarySeed: buildChainSummary([link], facts),
    });
    used.add(link.fromFactId);
    used.add(link.toFactId);
  }

  if (!chains.length) {
    chains.push({
      links: links.slice(0, 2),
      headFactId: links[0].fromFactId,
      summarySeed: buildChainSummary(links.slice(0, 2), facts),
    });
  }

  return chains;
}

export function linkedThemesFromChain(chain: ProactiveTopicChain, facts: ProactiveSignalFact[]): string[] {
  const ids = new Set<string>();
  for (const link of chain.links) {
    ids.add(link.fromFactId);
    ids.add(link.toFactId);
  }
  if (!ids.size && chain.headFactId) {
    ids.add(chain.headFactId);
  }
  return [...ids]
    .map((id) => factById(facts, id))
    .filter(Boolean)
    .map((fact) => fact!.detail.slice(0, 80))
    .slice(0, 2);
}

export function anchorFromChain(
  chain: ProactiveTopicChain,
  facts: ProactiveSignalFact[],
): string {
  for (const link of chain.links) {
    const to = factById(facts, link.toFactId);
    if (to?.kind === "file") {
      return to.detail.slice(0, 180);
    }
    if (to?.kind === "clipboard") {
      return to.detail.slice(0, 180);
    }
  }
  const head = factById(facts, chain.headFactId);
  return head?.detail.slice(0, 180) ?? chain.summarySeed.slice(0, 180);
}
