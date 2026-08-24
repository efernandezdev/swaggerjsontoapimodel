#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { OpenAPIV3 } from "openapi-types";

type OpenApiDocument = OpenAPIV3.Document;

type HttpMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "options"
  | "head";

// --------------------------------------------------
// CLI
// --------------------------------------------------

const args = process.argv.slice(2);

if (!args[0] || args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage:

  swaggerjsontoapimodel <openapi.json | url> [options]

Options:
  -o, --output <dir>      Output directory (e.g., ./newFolder/) -> newFolder/model/
  -bs, --base-path <path> Base path to strip from route names (e.g., /api/v1/)
  -h, --help              Show help

Example:

  swaggerjsontoapimodel openapi.json -o ./generated -bs api/v1
  swaggerjsontoapimodel https://api.example.com/openapi.json -o ./generated -bs /api/v1/
`);

  process.exit(args[0] ? 0 : 1);
}

const inputSource = args[0];

let outputDir: string = "./api-model/";
let basePath: string = "";

for (let i = 1; i < args.length; i++) {
  const arg = args[i];

  switch (arg) {
    case "-o":
    case "--output": {
      const value = args[++i];

      if (!value || value.startsWith("-")) {
        console.error(`Error: ${arg} requires a directory.`);
        process.exit(1);
      }

      outputDir = `${value.replace(/\/$/, "")}/api-model/`;
      break;
    }

    case "-bs":
    case "--base-path": {
      const value = args[++i];

      if (!value || value.startsWith("-")) {
        console.error(`Error: ${arg} requires a path.`);
        process.exit(1);
      }

      basePath = value;
      break;
    }

    default:
      console.error(`Error: unknown option "${arg}".`);
      process.exit(1);
  }
}

// --------------------------------------------------
// Name helpers
// --------------------------------------------------

function pascalCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function camelCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toLowerCase() + part.slice(1))
    .join("");
}

function safeFileName(value: string): string {
  return value?.toLocaleLowerCase() || "Unknown";
}

function refName(ref: string): string {
  const parts = ref.split("/");
  const name = parts.at(-1);

  if (!name) {
    throw new Error(`Invalid OpenAPI reference: ${ref}`);
  }

  return name;
}

function getQueryParamInterfaceName(
  path: string,
  method: HttpMethod,
  base: string,
): string {
  let cleanPath = path;

  if (base) {
    const normalizedBase = base.startsWith("/") ? base : `/${base}`;

    const strippedBase = normalizedBase.endsWith("/")
      ? normalizedBase.slice(0, -1)
      : normalizedBase;

    if (cleanPath.startsWith(strippedBase)) {
      cleanPath = cleanPath.slice(strippedBase.length);
    }
  }

  const pathWords = cleanPath
    .replace(/\/\{[^}]*\}/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ");

  return pascalCase(`${method} ${pathWords}`);
}

// --------------------------------------------------
// OpenAPI -> TypeScript mapping
// --------------------------------------------------

function primitiveType(
  schema: OpenAPIV3.SchemaObject,
): "number" | "string" | "boolean" | null {
  switch (schema.type) {
    case "integer":
    case "number":
      return "number";

    case "string":
      return "string";

    case "boolean":
      return "boolean";

    default:
      return null;
  }
}

// --------------------------------------------------
// Collect references
// --------------------------------------------------

function collectReferences(
  schema: OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject,
  result: Set<string> = new Set<string>(),
) {
  if (!schema || typeof schema !== "object") {
    return result;
  }

  if (isReferenceObject(schema)) {
    result.add(refName(schema.$ref));

    return result;
  }

  if (schema.type === "array") {
    collectReferences(schema.items, result);
  }

  if (schema.properties) {
    for (const property of Object.values(schema.properties)) {
      collectReferences(property, result);
    }
  }

  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  ) {
    collectReferences(schema.additionalProperties, result);
  }

  for (const schemas of [schema.allOf, schema.oneOf, schema.anyOf]) {
    if (schemas) {
      for (const item of schemas) {
        collectReferences(item, result);
      }
    }
  }

  return result;
}

// --------------------------------------------------
// Schema -> TS type
// --------------------------------------------------

function isReferenceObject(
  schema: OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject,
): schema is OpenAPIV3.ReferenceObject {
  return "$ref" in schema;
}

function schemaToType(
  schema: OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject,
): string {
  if (!schema) {
    return "unknown";
  }

  // $ref
  if (isReferenceObject(schema)) {
    return pascalCase(refName(schema.$ref));
  }

  // nullable
  const nullable = schema.nullable === true;

  // primitive
  let type: string = primitiveType(schema) ?? "";

  // array
  if (schema.type === "array") {
    const itemType = schemaToType(schema.items);

    // Parentheses are needed for arrays of unions.
    type = buildArrayType(itemType, type);
  }

  // object with additionalProperties
  if (schema.type === "object" && schema.additionalProperties) {
    type = buildObjectType(schema, type);
  }

  // allOf
  if (Array.isArray(schema.allOf)) {
    type = schema.allOf.map((item) => schemaToType(item)).join(" & ");
  }

  // oneOf
  if (Array.isArray(schema.oneOf)) {
    type = schema.oneOf.map((item) => schemaToType(item)).join(" | ");
  }

  // anyOf
  if (Array.isArray(schema.anyOf)) {
    type = schema.anyOf.map((item) => schemaToType(item)).join(" | ");
  }

  if (!type) {
    if (schema.type === "object") {
      type = "Record<string, unknown>";
    } else {
      type = "unknown";
    }
  }

  if (nullable && !type.includes("null")) {
    type = `${type} | null`;
  }

  return type;
}

function buildObjectType(schema: any, type: string | null): string {
  if (schema.additionalProperties === true) {
    return "Record<string, unknown>";
  } else {
    return `Record<string, ${schemaToType(schema.additionalProperties)}>`;
  }
}

function buildArrayType(itemType: any, type: string | null): string {
  if (itemType.includes(" | ") || itemType.includes(" & ")) {
    return `(${itemType})[]`;
  } else {
    return `${itemType}[]`;
  }
}

// --------------------------------------------------
// Generate interface
// --------------------------------------------------

function generateInterface({
  schemaName,
  schema,
  pathAbove,
}: {
  schemaName: string;
  schema: OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject;
  pathAbove?: boolean;
}): string {
  if ("$ref" in schema) {
    throw new Error(
      `Cannot generate interface "${schemaName}" from a reference: ${schema.$ref}`,
    );
  }

  const interfaceName: string = pascalCase(schemaName);

  const imports = new Set<string>();

  collectReferences(schema, imports);

  // Don't import itself.
  imports.delete(schemaName);

  const importBlock = [...imports]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const typeName = pascalCase(name);
      const fileName = camelCase(name);

      const folderPath = pathAbove ? `../${fileName}` : `./${fileName}`;

      return `import type { ${typeName} } from "${folderPath}";`;
    })
    .join("\n");

  const required = new Set(schema.required || []);

  const properties = schema.properties || {};

  const propertyLines = Object.entries(properties)
    .map(([propertyName, propertySchema]) => {
      const type = schemaToType(propertySchema);

      const optional = required.has(propertyName) ? "" : "?";

      const normalizeCamelCase = camelCase(propertyName);

      return `  ${normalizeCamelCase}${optional}: ${type};`;
    })
    .join("\n");

  const typeEnum = Array.isArray(schema.enum)
    ? schema.enum.map((value) => JSON.stringify(value)).join(" | ")
    : undefined;

  const body = schema.enum
    ? `export type ${interfaceName} = ${typeEnum}`
    : `export interface ${interfaceName} {\n${propertyLines || ""}\n}`;

  if (importBlock) {
    return `${importBlock}\n\n${body}\n`;
  }

  return `${body}\n`;
}

// --------------------------------------------------
// Extract Query Parameters
// --------------------------------------------------

function extractQueryParametersSchema(
  operation: OpenAPIV3.OperationObject,
): OpenAPIV3.SchemaObject | null {
  if (!operation.parameters || !Array.isArray(operation.parameters)) {
    return null;
  }

  const queryParams = operation.parameters.filter(
    (parameter): parameter is OpenAPIV3.ParameterObject =>
      "in" in parameter && parameter.in === "query",
  );

  if (queryParams.length === 0) {
    return null;
  }

  const properties: Record<
    string,
    OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject
  > = {};

  const required: string[] = [];

  for (const param of queryParams) {
    if (param.schema) {
      properties[param.name] = param.schema;
    }

    if (param.required) {
      required.push(param.name);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function queryParamsFn(openapi: OpenApiDocument, methods: HttpMethod[]) {
  const queryParams: Record<string, OpenAPIV3.SchemaObject> = {};

  for (const [pathKey, pathItem] of Object.entries(openapi.paths)) {
    if (!pathItem) {
      continue;
    }
    for (const method of methods) {
      const operation = pathItem[method];

      if (operation) {
        const querySchema = extractQueryParametersSchema(operation);

        if (querySchema) {
          const querySchemaName = getQueryParamInterfaceName(
            pathKey,
            method,
            basePath,
          );

          queryParams[querySchemaName] = querySchema;
        }
      }
    }
  }

  return queryParams;
}

async function resource(): Promise<OpenApiDocument> {
  const isUrl =
    inputSource.startsWith("http://") || inputSource.startsWith("https://");

  if (isUrl) {
    try {
      console.log(`Fetching OpenAPI from URL: ${inputSource}`);
      const response = await fetch(inputSource);

      if (!response.ok) {
        console.error(
          `Failed to fetch URL: ${response.status} ${response.statusText}`,
        );
        process.exit(1);
      }

      return (await response.json()) as OpenApiDocument;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(`Error fetching OpenAPI from URL: ${message}`);
      process.exit(1);
    }
  } else {
    if (!existsSync(inputSource)) {
      console.error(`File not found: ${inputSource}`);
      process.exit(1);
    }

    return JSON.parse(readFileSync(inputSource, "utf8")) as OpenApiDocument;
  }
}

// --------------------------------------------------
// Main Execution
// --------------------------------------------------

async function main() {
  const openapi = await resource();

  const allSchemas: Record<
    string,
    OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject
  > = {};

  // 1. Collect schemas from components
  if (openapi.components?.schemas) {
    for (const [schemaName, schema] of Object.entries(
      openapi.components.schemas,
    )) {
      allSchemas[schemaName] = schema;
    }
  }

  // 2. Collect query parameters from paths
  let queryParams: Record<
    string,
    OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject
  > = {};

  if (openapi.paths) {
    const methods: HttpMethod[] = [
      "get",
      "post",
      "put",
      "delete",
      "patch",
      "options",
      "head",
    ];

    queryParams = queryParamsFn(openapi, methods);
  }

  if (
    Object.keys(allSchemas).length === 0 &&
    Object.keys(queryParams).length === 0
  ) {
    console.error(
      "OpenAPI document does not contain schemas or query parameters.",
    );
    process.exit(1);
  }

  // Generate folder output
  rmSync(outputDir, {
    recursive: true,
    force: true,
  });

  mkdirSync(outputDir, {
    recursive: true,
  });

  // Generate allSchemas
  if (Object.keys(allSchemas).length) {
    rmSync(outputDir, {
      recursive: true,
      force: true,
    });

    mkdirSync(outputDir, {
      recursive: true,
    });

    for (const [schemaName, schema] of Object.entries(allSchemas)) {
      const fileName = `${camelCase(schemaName)}.ts`;

      const content = generateInterface({ schemaName, schema });

      const filePath = join(outputDir, fileName);

      writeFileSync(filePath, content, "utf8");

      console.log(`${fileName}`);
    }
  }

  // Generate queryParams into query-params
  if (Object.keys(queryParams).length) {
    rmSync(outputDir + "/query-params", {
      recursive: true,
      force: true,
    });

    mkdirSync(outputDir + "/query-params", {
      recursive: true,
    });

    for (const [schemaName, schema] of Object.entries(queryParams)) {
      const fileName = `${camelCase(schemaName)}.ts`;

      const content = generateInterface({
        schemaName,
        schema,
        pathAbove: true,
      });

      const filePath = join(outputDir + "/query-params", fileName);

      writeFileSync(filePath, content, "utf8");

      console.log(`${fileName}`);
    }
  }
}

await main();
