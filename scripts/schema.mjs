import Ajv from 'ajv';
import addFormats from 'ajv-formats';

function rejectRequiredCrossedBounds(schema, depth = 32) {
  if (!schema || typeof schema !== 'object' || depth === 0 || schema.$ref || schema.nullable) return;
  if (schema.type === 'string' && schema.minLength > schema.maxLength)
    throw new TypeError('unsatisfiable JSON Schema: crossed string bounds');
  if (schema.type === 'array' && schema.minItems > schema.maxItems)
    throw new TypeError('unsatisfiable JSON Schema: crossed array bounds');
  if (schema.type === 'number' || schema.type === 'integer') {
    const lower = Math.max(schema.minimum ?? -Infinity, schema.exclusiveMinimum ?? -Infinity);
    const upper = Math.min(schema.maximum ?? Infinity, schema.exclusiveMaximum ?? Infinity);
    if (lower > upper || lower === upper && (schema.exclusiveMinimum === lower || schema.exclusiveMaximum === upper))
      throw new TypeError('unsatisfiable JSON Schema: crossed numeric bounds');
    if (schema.type === 'integer') {
      const first = schema.exclusiveMinimum === lower ? Math.floor(lower) + 1 : Math.ceil(lower);
      const last = schema.exclusiveMaximum === upper ? Math.ceil(upper) - 1 : Math.floor(upper);
      if (Number.isSafeInteger(first) && Number.isSafeInteger(last) && first > last)
        throw new TypeError('unsatisfiable JSON Schema: integer bounds contain no integer');
    }
  }
  if (schema.type === 'object')
    for (const name of schema.required ?? []) rejectRequiredCrossedBounds(schema.properties?.[name], depth - 1);
}

export function resultValidator(schema) {
  if (schema === undefined) return () => {};
  if (schema.$async) throw new TypeError('invalid JSON Schema: asynchronous schemas are not supported');
  const validator = new Ajv({strict:false,strictSchema:true,allErrors:true});
  addFormats(validator);
  let validate;
  try { validate = validator.compile(schema); }
  catch(error) { throw new TypeError(`invalid JSON Schema: ${error.message}`); }
  rejectRequiredCrossedBounds(schema);
  if (schema.type === 'object' && schema.additionalProperties === false && Array.isArray(schema.required) && schema.required.some(name =>
    !Object.hasOwn(schema.properties ?? {}, name) && !Object.keys(schema.patternProperties ?? {}).some(pattern => new RegExp(pattern, 'u').test(name))))
    throw new TypeError('unsatisfiable JSON Schema: required property is excluded by additionalProperties:false');
  return value => {
    if (!validate(value)) throw new TypeError(`schema validation failed: ${validator.errorsText(validate.errors)}`);
  };
}
