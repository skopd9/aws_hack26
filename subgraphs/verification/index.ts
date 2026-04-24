/**
 * `verification` subgraph (port 4004).
 *
 * Grounds risk assessment in real-world product behavior via TinyFish: takes
 * a claim summary + product domain and returns evidence snippets that the
 * domain plausibly practices the claim.
 */
import gql from 'graphql-tag';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { verifyProductUsage } from '../../lib/integrations/tinyfish';

const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key"])

  type EvidenceItem {
    url: String!
    snippet: String!
    confidence: Float!
  }

  type VerificationResult {
    evidence: [EvidenceItem!]!
    confidence: Float!
    summary: String!
  }

  type Query {
    verifyProductUsage(
      claimSummary: String!
      productDomain: String!
    ): VerificationResult!
  }
`;

const resolvers = {
  Query: {
    verifyProductUsage: (
      _: unknown,
      args: { claimSummary: string; productDomain: string }
    ) => verifyProductUsage(args.claimSummary, args.productDomain)
  }
};

export const verificationSchema = buildSubgraphSchema({ typeDefs, resolvers });
