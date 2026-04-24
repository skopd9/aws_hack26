/**
 * `litigation` subgraph (port 4003).
 *
 * Wraps PACER / CourtListener litigation lookups. Returns assignee-keyed
 * litigation profiles; not federated as an entity for now (could later be
 * `LitigationProfile @key(fields: "assignee")`).
 */
import gql from 'graphql-tag';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { litigationHistory } from '../../lib/integrations/pacer';

const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key"])

  type LitigationCase {
    caseNo: String!
    court: String!
    filedDate: String!
    defendants: [String!]!
  }

  type IprOutcome {
    petition: String!
    result: String!
  }

  type LitigationProfile {
    assigneeLitigationCount: Int!
    isKnownNPE: Boolean!
    recentCases: [LitigationCase!]!
    relatedIprOutcomes: [IprOutcome!]!
  }

  type Query {
    pacerLitigationHistory(assignee: String!): LitigationProfile!
  }
`;

const resolvers = {
  Query: {
    pacerLitigationHistory: (_: unknown, { assignee }: { assignee: string }) =>
      litigationHistory(assignee)
  }
};

export const litigationSchema = buildSubgraphSchema({ typeDefs, resolvers });
