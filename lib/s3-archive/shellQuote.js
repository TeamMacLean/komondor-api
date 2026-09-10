const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Quotes one argument for a POSIX shell. Control characters are rejected so a
 * generated deletion command always remains one inspectable line.
 */
const shellQuote = (value) => {
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) {
    throw new Error("Cannot shell-quote a value containing control characters");
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
};

module.exports = { shellQuote };
