// @ts-nocheck
/**
 * WunderGraph server hooks — used only when running a wundernode.
 * Empty for now; add pre/post hooks for auth, caching, logging if needed.
 */
import { configureWunderGraphServer } from '@wundergraph/sdk/server';

export default configureWunderGraphServer(() => ({
  hooks: {
    queries: {},
    mutations: {}
  }
}));
