const { ensureCurrentEveKnowledge } = require("../dist-electron/eve-knowledge-refresh.js");

ensureCurrentEveKnowledge((message) => {
  process.stdout.write(String(message) + "\n");
}, true)
  .then((result) => {
    process.stdout.write("RESULT " + JSON.stringify(result) + "\n");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
