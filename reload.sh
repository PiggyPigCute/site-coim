git pull
npm install --omit=dev
pm2 reload coim || PORT=3009 pm2 start server.js --name coim
