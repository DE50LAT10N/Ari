export type TextRevealOptions = {
  charsPerSecond: number;
  onReveal: (displayText: string, delta: string) => void;
  onComplete?: () => void;
};

export class TextRevealEngine {
  private targetText = "";
  private displayText = "";
  private timer: number | null = null;
  private options: TextRevealOptions | null = null;
  private running = false;
  private streamEnded = false;
  private hasContent = false;

  start(options: TextRevealOptions): void {
    this.options = options;
    this.running = true;
    this.streamEnded = false;
    this.hasContent = false;
  }

  setTarget(text: string): void {
    this.targetText = text;
    if (text.length > 0) {
      this.hasContent = true;
    }
    if (this.running && this.options) {
      this.scheduleTick();
    }
  }

  markStreamEnded(): void {
    this.streamEnded = true;
    if (this.running && this.options) {
      this.scheduleTick();
    }
  }

  flush(): void {
    if (!this.targetText || this.displayText === this.targetText) {
      this.streamEnded = true;
      this.finishIfDone();
      return;
    }
    const delta = this.targetText.slice(this.displayText.length);
    this.displayText = this.targetText;
    this.hasContent = this.displayText.length > 0;
    this.options?.onReveal(this.displayText, delta);
    this.streamEnded = true;
    this.finishIfDone();
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.targetText = "";
    this.displayText = "";
    this.options = null;
    this.streamEnded = false;
    this.hasContent = false;
  }

  isActive(): boolean {
    return (
      this.running &&
      (this.displayText !== this.targetText || this.hasPendingBlips())
    );
  }

  private hasPendingBlips(): boolean {
    return false;
  }

  getDisplayText(): string {
    return this.displayText;
  }

  isCaughtUp(): boolean {
    return this.displayText === this.targetText;
  }

  private scheduleTick(): void {
    if (!this.options || !this.running) {
      return;
    }
    if (this.timer !== null) {
      return;
    }

    const tick = () => {
      this.timer = null;
      if (!this.options || !this.running) {
        return;
      }

      if (!this.hasContent) {
        if (this.streamEnded) {
          this.finishIfDone();
        }
        return;
      }

      if (this.displayText.length >= this.targetText.length) {
        this.finishIfDone();
        return;
      }

      const charsPerTick = Math.max(
        1,
        Math.round(this.options.charsPerSecond / 20),
      );
      const nextLength = Math.min(
        this.targetText.length,
        this.displayText.length + charsPerTick,
      );
      const delta = this.targetText.slice(this.displayText.length, nextLength);
      this.displayText = this.targetText.slice(0, nextLength);
      this.options.onReveal(this.displayText, delta);

      if (this.displayText.length < this.targetText.length) {
        this.timer = window.setTimeout(tick, 48);
      } else {
        this.finishIfDone();
      }
    };

    this.timer = window.setTimeout(tick, 0);
  }

  private finishIfDone(): void {
    if (!this.hasContent) {
      if (this.streamEnded) {
        this.running = false;
        this.options?.onComplete?.();
      }
      return;
    }

    if (this.displayText !== this.targetText) {
      this.scheduleTick();
      return;
    }

    if (!this.streamEnded) {
      return;
    }

    this.running = false;
    this.options?.onComplete?.();
  }
}
