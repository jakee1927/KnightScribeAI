<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1MiLIa-oinOjjVrBpFtb9156UnvGMuVUk

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create `.env.local` (or export env vars) with:
   - `OPENWEBUI_API_KEY=...` (required)
   - `OPENWEBUI_BASE_URL=http://localhost:3000` (or your OpenWebUI host)
   - `OPENWEBUI_MODEL=gemma3:12b` (optional)
   - `OPENWEBUI_OCR_MODEL=deepseek-ocr:latest` (optional)
3. (Optional) Keep `GEMINI_API_KEY` if you still use Gemini-specific code paths.
4. Run the app:
   `npm run dev`
