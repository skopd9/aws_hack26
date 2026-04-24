/**
 * `analysis` subgraph (port 4005).
 *
 * Bulk-text reasoning powered by Kimi K2.6 on Akash ML. Demonstrates real
 * Cosmo federation by **extending** the `Patent` entity (owned by the
 * `patents` subgraph) with a `summarize(claimText, userStack)` field —
 * the Cosmo Router resolves cross-subgraph queries like:
 *
 *   query {
 *     usptoSearch(query: "agentic toolchain") {
 *       patentNo
 *       title
 *       summarize(claimText: "...", userStack: "Next.js + tRPC") {
 *         summary
 *         roadmapImplication
 *       }
 *     }
 *   }
 *
 * by calling `patents.usptoSearch` then `analysis._entities` for each hit.
 */
import gql from 'graphql-tag';
import { buildSubgraphSchema } from '@apollo/subgraph';
import {
  summarizeClaim,
  rerankPriorArt
} from '../../lib/integrations/akashml';

const typeDefs = gql`
  extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.7"
      import: ["@key", "@external"]
    )

  type ClaimSummary {
    summary: String!
    roadmapImplication: String!
  }

  type RerankedCandidate {
    repo: String!
    score: Float!
    reason: String!
  }

  input PriorArtCandidateInput {
    repo: String!
    evidenceSnippet: String!
    firstCommitDate: String!
  }

  type Patent @key(fields: "patentNo") {
    patentNo: ID! @external
    summarize(claimText: String!, userStack: String!): ClaimSummary
  }

  type Query {
    summarizeClaim(
      patentNo: ID!
      claimText: String!
      userStack: String!
    ): ClaimSummary!
    rerankPriorArt(
      claimSummary: String!
      candidates: [PriorArtCandidateInput!]!
    ): [RerankedCandidate!]!
  }
`;

const resolvers = {
  Patent: {
    __resolveReference: (ref: { patentNo: string }) => ({
      patentNo: ref.patentNo
    }),
    summarize: (
      parent: { patentNo: string },
      args: { claimText: string; userStack: string }
    ) =>
      summarizeClaim({
        patentNo: parent.patentNo,
        claimText: args.claimText,
        userStack: args.userStack
      })
  },
  Query: {
    summarizeClaim: (_: unknown, args: any) => summarizeClaim(args),
    rerankPriorArt: (_: unknown, args: any) => rerankPriorArt(args)
  }
};

export const analysisSchema = buildSubgraphSchema({ typeDefs, resolvers });
