/**
 * JSON Schema validator for the MCP clients of the backend (external servers, the Craft apps, the health check).
 *
 * The Craft apps are Rust programs: their tool schemas carry the number formats of Rust (`uint`, `uint8`, `uint32`,
 * `uint64` ...), which are not JSON Schema formats. The SDK's validator (Ajv) answers each one with a console warning
 * ("unknown format ... ignored in schema"), twice per schema and again on every restart in development, about 130 lines
 * every time. Ajv ignores such a format anyway (it only describes the range of the number), so nothing is lost by not
 * printing the warning. Warnings about anything else still reach the console.
 */
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';

type Schema = Parameters<AjvJsonSchemaValidator['getValidator']>[0];

const UNKNOWN_FORMAT = /^unknown format "[\w-]+" ignored in schema/;

class QuietAjvValidator extends AjvJsonSchemaValidator {
  override getValidator<T>(schema: Schema) {
    // Ajv compiles synchronously inside getValidator, so the filter is on for exactly that call
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && UNKNOWN_FORMAT.test(args[0])) return;
      warn.apply(console, args);
    };
    try {
      return super.getValidator<T>(schema);
    } finally {
      console.warn = warn;
    }
  }
}

export const mcpSchemaValidator = new QuietAjvValidator();
