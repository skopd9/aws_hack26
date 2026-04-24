// @ts-nocheck
/**
 * WunderGraph config — used only when running a wundernode (Mode B in README).
 * The in-process Next.js agent (Mode A) does not consume this file.
 */
import {
  configureWunderGraphApplication,
  introspect,
  templates
} from '@wundergraph/sdk';

const usptoPatentsView = introspect.openApiV2({
  apiNamespace: 'uspto',
  source: { kind: 'object', openAPIJSON: JSON.stringify({ openapi: '3.0.0', paths: {} }) }
});

configureWunderGraphApplication({
  apis: [usptoPatentsView],
  codeGenerators: [{ templates: [...templates.typescript.all] }],
  server: { listen: { host: '127.0.0.1', port: 9991 } },
  cors: { allowedOrigins: ['http://localhost:3000'] },
  security: { enableGraphQLEndpoint: false }
});
