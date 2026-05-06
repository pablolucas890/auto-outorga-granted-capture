#!/bin/bash

if [ -z "$1" ]; then
    echo "Usage: $0 <date>"
    exit 0
fi
DATE=$1

# Clean temporary files
rm -f /tmp/domg*

# Get DOMG data and convert to JSON
DOMG_URL="https://www.jornalminasgerais.mg.gov.br/api/v1/Jornal/ObterEdicaoPorDataPublicacao?dataPublicacao=$DATE"
DOMG_DATA=$(curl -s "$DOMG_URL")
JSON_DATA=$(echo "$DOMG_DATA" | jq)
if [ -z "$JSON_DATA" ]; then
    exit 0
fi

# Get base64 encoded file
BASE64_FILE=$(echo "$JSON_DATA" | jq -r '.dados.arquivoCadernoPrincipal.arquivo')
if [ -z "$BASE64_FILE" ]; then
    exit 0
fi

# Get and save binary file
echo "$BASE64_FILE" | base64 -d > /tmp/domg.bin
if [ $? -ne 0 ]; then
    exit 0
fi

# Get PDF file
openssl smime -inform DER -verify -noverify -in /tmp/domg.bin -out /tmp/domg.pdf &> /dev/null

# Get page numbers
BEGIN_PAGE=$(echo "$JSON_DATA" | grep 'Meio Ambiente' -A 5 | grep 'pagina' | awk '{print $2}' | head -n 1)
END_PAGE=$(echo "$JSON_DATA" | grep 'Meio Ambiente' -A 5 | grep 'pagina' | awk '{print $2}' | tail -n 1)
if [ -z "$BEGIN_PAGE" ] || [ -z "$END_PAGE" ]; then
    exit 0
fi

# Split PDF
qpdf /tmp/domg.pdf --pages /tmp/domg.pdf $BEGIN_PAGE-$END_PAGE -- /tmp/domg-environment.pdf
if [ $? -ne 0 ]; then
    exit 0
fi

# Get text
pdftotext /tmp/domg-environment.pdf /tmp/domg-environment.txt
if [ $? -ne 0 ]; then
    exit 0
fi

# Get text
TEXT=$(cat /tmp/domg-environment.txt)
if [ -z "$TEXT" ]; then
    exit 0
fi
echo "$TEXT"