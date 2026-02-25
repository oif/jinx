# Image Processing via Telegram

Jinx can process images sent through Telegram. 
The image payload must be fetched via the Telegram Bot API (`ctx.api.getFile`) and downloaded via HTTP using the bot token. It is then encoded to Base64.
The `pi-coding-agent` SDK accepts images in the `options` parameter of `AgentSession.prompt(text, { images })`. The image array must conform to the `ImageContent` type:
```typescript
{
  type: "image",
  mimeType: "image/jpeg" | "image/png",
  data: string // base64 string
}
```