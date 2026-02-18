@echo off
set PATH=%PATH%;C:\Program Files\nodejs
set GEMINI_API_KEY=AIzaSyB0ez4NQKVogZtY3rcZeUXf5OE_JQ8jYAw
cd /d C:\projects\e-naradomum-rpa
npx ts-node src/index.ts %*
