

## Backends e formato Dots


O parser aceita `<invoke name="...">...</invoke>`, o formato DSML do DeepSeek e chamadas envolvidas por `<dots_function_call>...</dots_function_call>`. Com `ENABLE_LOCAL_TOOLS=true`, as tools são executadas no workspace do proxy e o resultado retorna ao mesmo modelo até a resposta final.

Para o login sem copiar cookies criptografados do Windows, `npm run login` exporta `storage-state.json` ao pressionar Ctrl+C. Configure `LOGIN_SETUP_TOKEN`, abra `/login?token=...` no domínio do Railway e envie o arquivo pela página. Use um Volume montado em `/app/deepseek_profile`.
