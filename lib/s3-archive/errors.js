class ArchiveRefusalError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ArchiveRefusalError";
    this.exitCode = 1;
    this.details = details;
  }
}

class ArchiveConfigurationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ArchiveConfigurationError";
    this.exitCode = 2;
    this.details = details;
  }
}

class ArchiveMutationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ArchiveMutationError";
    this.exitCode = 3;
    this.details = details;
  }
}

module.exports = {
  ArchiveConfigurationError,
  ArchiveMutationError,
  ArchiveRefusalError,
};
