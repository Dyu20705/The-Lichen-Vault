export class DomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, public readonly details?: unknown) {
    super(message, "VALIDATION_ERROR");
  }
}

export class InvariantError extends DomainError {
  constructor(message: string) {
    super(message, "INVARIANT_VIOLATION");
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, identifier: string) {
    super(`${resource} with identifier "${identifier}" not found.`, "NOT_FOUND");
  }
}

export class StorageError extends DomainError {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message, "STORAGE_ERROR");
  }
}

export class MigrationError extends DomainError {
  constructor(message: string, public readonly rawPayload?: unknown) {
    super(message, "MIGRATION_ERROR");
  }
}

export class PolicyError extends DomainError {
  constructor(message: string) {
    super(message, "POLICY_VIOLATION");
  }
}
