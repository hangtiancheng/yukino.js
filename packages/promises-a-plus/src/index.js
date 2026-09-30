import adapter from "./test-adapter.js";
import promisesAPlusTests from "promises-aplus-tests";

promisesAPlusTests(adapter, function (err) {
  if (err) {
    console.error("Tests failed!");
    console.error(err);
    process.exit(1);
  } else {
    console.log("Tests finished.");
  }
});
