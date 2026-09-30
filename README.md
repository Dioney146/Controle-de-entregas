# Controle de Entregas · Delly's (Roteirização AM)

Site que substitui a planilha `CONTROLE_DE_ENTREGAS.xlsm`. Mesmo fluxo, sem o trabalho manual.

| Planilha (antes)                                    | Site (agora)                                                                                                 |
|-----------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| Colar em **BASE DA PROGRAMAÇÃO** + PROCX            | Tela **Programação** → *Colar do RoadNet* (Ctrl+V ou envia o arquivo exportado)                               |
| **PROGRAMAÇÃO** verde (tem carga) / laranja (sem)   | Igual: verde = placa com carga; laranja = veículo da frota fixa sem carga; amarelo = "RESERVADO"             |
| **VEÍCULOS**: marcar STATUS placa por placa         | **Automático**: quem tem carga no RoadNet já vai para o frete. Dá para desmarcar/incluir na caixinha "Sai?"  |
| **FRETE** montado coluna por coluna                 | Botão **Gerar frete** monta tudo: zona, placa, transp., entregas, kg, valor, destino, motorista e entregador |
| **SAÍDAS** (cópia do frete)                         | Na tela **Frete / Saídas**, registrar a hora de saída (digitar ou "Saiu agora")                               |
| **RETORNO** (espelho das saídas)                    | Tela **Retorno**: cancelados, reentregas, pendentes, celular e **Checkout** com data/hora e quem deu          |
| **HISTÓRICO** (copiar e colar)                      | Automático: tudo que teve saída registrada fica no **Histórico**, com filtros e exportação para Excel         |

### De onde vem cada campo do frete
- **Zona**: tirada da descrição da rota (`AM-ZLESTE (TOP)` → LESTE, `AM-CSUL` → C-SUL, `FLUVIAL`, `FOOD`, `(SENDAS)`/agendamento → AGENDADO). Dá para corrigir na tela.
- **Transportadora / tipo**: do cadastro de Veículos.
- **Entregas, KG, Valor, Infor**: do RoadNet (Número de paradas, Peso, Valor, Descrição).
- **Motorista**: motorista fixo do cadastro; se não tiver, o **último motorista que saiu com aquela placa**.
- **Entregador**: coluna *Trabalhadores* do RoadNet; se vazia, entregador fixo do cadastro ou o último usado na placa.

---

## Como colocar no ar (tudo pelo navegador)

### 1. Supabase (banco de dados)
1. Entre em https://supabase.com → **New project** (região *South America (São Paulo)*). Guarde a senha.
2. Menu **SQL Editor → New query**. Abra cada arquivo da pasta `supabase/`, copie todo o conteúdo, cole e clique em **Run**, **nesta ordem**:
   1. `01_schema.sql` (cria as tabelas)
   2. `02_seed_veiculos.sql` (os 54 veículos da aba VEÍCULOS)
   3. `03_historico_parte1.sql` … `03_historico_parte5.sql` (as 2.147 linhas da aba HISTÓRICO). Rode cada parte **uma vez só**.
3. Menu **Authentication → Sign In / Providers → Email**: desligue **Allow new users to sign up** (só entra quem você cadastrar).
4. Menu **Authentication → Users → Add user → Create new user**: crie um login para cada pessoa (você, portaria, monitoramento). Marque **Auto Confirm User**.
5. Menu **Project Settings → API** (ou *Data API*): copie a **Project URL** e a chave **anon public**.

### 2. GitHub (código)
1. Em https://github.com/new crie um repositório (ex.: `controle-entregas-dellys`), **Private**.
2. Clique em **uploading an existing file** e arraste **todo o conteúdo** desta pasta (as pastas `app`, `components`, `lib`, `supabase` e os arquivos `package.json`, `package-lock.json`, `next.config.js`, `.gitignore`, `README.md`).
3. **Commit changes**.

### 3. Vercel (site)
1. Em https://vercel.com → **Add New… → Project** → importe o repositório.
2. Antes de clicar em Deploy, abra **Environment Variables** e crie:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL do Supabase
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = chave anon public
3. **Deploy**. Se criar as variáveis depois, vá em **Deployments → ⋯ → Redeploy**.

---

## Rotina do dia
1. **Programação**: *Colar do RoadNet* → confira a data de saída (vem da "Sessão de roteirização") → **Salvar programação**.
2. Confira verdes/laranjas. Desmarque "Sai?" se algum veículo com carga não vai, ou marque um laranja que vai.
3. **Gerar frete** → complete motorista/entregador que faltar (campo vermelho) → **Imprimir frete** para a portaria.
4. Quando o veículo sai: digite a hora ou clique **Saiu agora**. A partir daí ele aparece no Retorno e no Histórico.
5. **Retorno** (monitoramento): preencha cancelados, reentregas, pendentes, marque o celular e clique **Checkout**. A tela atualiza sozinha para todo mundo.

Se precisar refazer a programação (RoadNet mudou), cole de novo e salve por cima; depois clique em **Gerar frete** outra vez. Veículos que já saíram são mantidos.

## Cadastro de veículos
- **Frota fixa** marcada = o veículo aparece em laranja quando ficar sem carga (é o "sinal" da planilha). Veio marcado para quem estava com STATUS ✓ na planilha.
- Placa roteirizada que não está cadastrada aparece em aviso na Programação, com atalho para cadastrar.
