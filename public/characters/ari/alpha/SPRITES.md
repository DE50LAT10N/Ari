# Спрайты Ari (alpha)

Положи PNG в эту папку. Прозрачный фон, один ракурс и масштаб.

## Эмоции (18)

| Файл | Эмоция в коде |
|------|----------------|
| `neutral.png` | neutral |
| `happy.png` | happy |
| `amused.png` | amused |
| `annoyed.png` | annoyed |
| `curious.png` | curious |
| `empathetic.png` | empathetic |
| `blush.png` | blush |
| `bored.png` | bored |
| `calm smile.png` | calm |
| `surprised.png` | surprised |
| `sad.png` | sad |
| `sleepy.png` | sleepy |
| `excited.png` | excited |
| `pensive.png` | pensive |
| `worried.png` | worried |
| `proud.png` | proud |
| `shy.png` | shy |
| `determined.png` | determined |

## Состояния (2)

| Файл | Когда |
|------|--------|
| `idle.png` | neutral + idle |
| `speaking.png` | state speaking (blip / ответ) |

`neutral.png` показывается при `emotion=neutral` и `state=thinking`.

Проверка: `npm run validate:sprites` — размер, наличие, дубликаты байтов.

Код: `src/character/emotionAssets.ts`, `src/character/characterRenderer.ts`.
