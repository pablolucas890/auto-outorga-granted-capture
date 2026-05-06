#!/bin/bash

if [ -z "$1" ]; then
    echo "Usage: $0 <date>"
    exit 1
fi

DATE=$1

# Get DOMG data and convert to JSON
DOMG_URL="https://www.jornalminasgerais.mg.gov.br/api/v1/Jornal/ObterEdicaoPorDataPublicacao?dataPublicacao=$DATE"
DOMG_DATA=$(curl -s "$DOMG_URL")
JSON_DATA=$(echo "$DOMG_DATA" | jq)

# Get base64 encoded file
BASE64_FILE=$(echo "$JSON_DATA" | jq -r '.dados.arquivoCadernoPrincipal.arquivo')

# Get and save binary file
BINARY_FILE=$(echo "$BASE64_FILE" | base64 -d > /tmp/domg.bin)

# Get PDF file
openssl smime -inform DER -verify -noverify -in /tmp/domg.bin -out /tmp/domg.pdf

# Get page numbers
BEGIN_PAGE=$(echo "$JSON_DATA" | grep 'Meio Ambiente' -A 5 | grep 'pagina' | awk '{print $2}' | head -n 1)
END_PAGE=$(echo "$JSON_DATA" | grep 'Meio Ambiente' -A 5 | grep 'pagina' | awk '{print $2}' | tail -n 1)

# Split PDF
qpdf /tmp/domg.pdf --pages /tmp/domg.pdf $BEGIN_PAGE-$END_PAGE -- /tmp/domg-environment.pdf

# Get text
pdftotext /tmp/domg-environment.pdf /tmp/domg-environment.txt

# Get text
echo "$(cat /tmp/domg-environment.txt)"