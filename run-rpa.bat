@echo off
set PATH=%PATH%;C:\Program Files\nodejs
set GEMINI_API_KEY=AIzaSyB0ez4NQKVogZtY3rcZeUXf5OE_JQ8jYAw
cd /d C:\projects\e-naradomum-rpa
npx ts-node src/index.ts -g "C:\Users\정동회계법인\Documents\보조금 지침\[최종본]+2025년+책임의료기관+통합+사업+안내(발간등록번호+추가★).pdf"
