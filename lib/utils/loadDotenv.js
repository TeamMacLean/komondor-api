const dotenv = require("dotenv");

/**
 * Loads `.env`, except under test.
 *
 * `dotenv.config()` used to be called at the top of app.js and server.js
 * directly, which meant that requiring either module inside jest read the
 * developer's own un-versioned `.env` into that worker's `process.env`. Tests
 * then ran against whatever happened to be in it — a real `UPLOAD_DIRECTORY`, a
 * real `HPC_TRANSFER_DIRECTORY`, a real `FULL_RECORDS_ACCESS_USERS` — so a
 * suite could pass on one machine and fail on another, or, far worse, pass on
 * the machine where a variable happened to be set and hide the case it was
 * written to cover. CI has no `.env` at all, so the two environments disagreed
 * by construction and CI was the stricter of the two.
 *
 * `dotenv.config()` does not overwrite a variable that is already set, so it
 * cannot be neutralised by clearing `process.env` in a jest setup file: it
 * simply refills whatever was cleared. Not calling it is the only way to stop
 * it. Under `NODE_ENV === "test"` a test therefore sees exactly the variables
 * it sets for itself, on every machine.
 *
 * This is the whole mechanism, in one place, so that neither entry point can
 * drift from the other.
 *
 * @returns {boolean} True if the file was loaded, false if skipped under test.
 */
const loadDotenv = () => {
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  dotenv.config();
  return true;
};

module.exports = { loadDotenv };
