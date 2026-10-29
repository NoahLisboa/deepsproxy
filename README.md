

## Backends e formato Dots

Use `PROXY_BACKEND=deepseek` para o Chat Web do DeepSeek ou `PROXY_BACKEND=custom` para encaminhar diretamente a uma API OpenAI-compatible, como AnyRouter. Para AnyRouter, configure `CUSTOM_API_BASE_URL=https://anyrouter.dev/api/v1` e `CUSTOM_API_KEY` com uma chave `sk-ar-...`.

O parser aceita `<invoke name="...">...</invoke>`, o formato DSML do DeepSeek e chamadas envolvidas por `<dots_function_call>...</dots_function_call>`. Com `ENABLE_LOCAL_TOOLS=true`, as tools são executadas no workspace do proxy e o resultado retorna ao mesmo modelo até a resposta final.

Para o login sem copiar cookies criptografados do Windows, `npm run login` exporta `storage-state.json` ao pressionar Ctrl+C. Configure `LOGIN_SETUP_TOKEN`, abra `/login?token=...` no domínio do Railway e envie o arquivo pela página. Use um Volume montado em `/app/deepseek_profile`.


## AnyRouter

Use `PROXY_BACKEND=custom`, `ANYROUTER_API_BASE_URL=https://anyrouter.dev/api/v1`, `ANYROUTER_API_KEY=sk-ar-v1-...` e opcionalmente `ANYROUTER_MODEL=anyrouter/free`. A chave é lida somente do ambiente e nunca fica no código.
