# Vapi assistant deploy

## Import the assistant

1. Replace `YOUR-DEPLOYMENT.example.com` in `assistant.json` with your deployed IP-Pulse URL (or `https://<ngrok-id>.ngrok-free.app` for local testing).
2. Replace `REPLACE_WITH_VAPI_WEBHOOK_SECRET` with a shared secret; put the same value in your app's `.env` as `VAPI_WEBHOOK_SECRET`.
3. Create the assistant via Vapi dashboard or CLI:
   ```bash
   curl -X POST https://api.vapi.ai/assistant \
     -H "Authorization: Bearer $VAPI_API_KEY" \
     -H "Content-Type: application/json" \
     -d @deploy/vapi/assistant.json
   ```

## Demo script (voice)

1. Call the Vapi number provisioned for the assistant.
2. Say: *"I'm building a RAG pipeline with pgvector. Are there any threats filed in the last six months?"*
3. IP-Pulse will run the full investigative chain (USPTO search → claim read → Kimi summarize → GitHub prior-art + Kimi rerank → PACER weight → compose RiskReport).
4. Vapi reads back the voice-friendly summary produced by `lib/vapi.toVoiceFriendly()`.

## Phone number

Provision via `Buy Number` in the Vapi dashboard and bind it to the assistant. Optional for the hackathon demo — a web-browser call from the Vapi dashboard works for showing off the integration.
