#!/usr/bin/env bash
# Mantém a landing do site (app/public/landing.html) igual ao index.html da raiz.
cd "$(dirname "$0")" && cp index.html app/public/landing.html && echo "landing sincronizada"
