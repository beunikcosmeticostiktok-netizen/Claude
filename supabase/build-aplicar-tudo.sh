#!/usr/bin/env bash
# Junta todas as migrações em um único arquivo para colar no SQL Editor do Supabase (uma vez).
set -euo pipefail
cd "$(dirname "$0")"
out="aplicar-tudo.sql"
{
  echo "-- ====================================================================="
  echo "-- Century Shalom — instalação completa do banco (gerado automaticamente)"
  echo "-- Cole TUDO no SQL Editor do Supabase e clique em Run. Se algum erro aparecer,"
  echo "-- NADA é gravado (tudo roda em uma única transação): envie o texto do erro."
  echo "-- ====================================================================="
  for f in migrations/*.sql; do
    echo; echo "-- ########## $(basename "$f") ##########"; cat "$f"
  done
  echo; echo "-- ########## registro das migrações (evita reaplicar pela integração do GitHub) ##########"
  echo "create schema if not exists supabase_migrations;"
  echo "create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);"
  echo "insert into supabase_migrations.schema_migrations (version, name) values"
  n=0; total=$(ls migrations/*.sql | wc -l)
  for f in migrations/*.sql; do
    n=$((n+1)); b=$(basename "$f" .sql); v=${b%%_*}; name=${b#*_}
    sep=","; [ "$n" -eq "$total" ] && sep=""
    echo "  ('$v', '$name')$sep"
  done
  echo "on conflict (version) do nothing;"
  echo; echo "-- avisa a API do Supabase para reconhecer as tabelas novas"
  echo "notify pgrst, 'reload schema';"
} > "$out"
echo "gerado $out: $(wc -l < "$out") linhas, $(wc -c < "$out") bytes"
