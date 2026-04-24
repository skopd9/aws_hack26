/**
 * `priorart` subgraph (port 4002).
 *
 * Surfaces invalidating prior-art evidence — GitHub via REST + via TinyFish
 * web search, scholarly papers, and tech news. Returns plain value types
 * (no federation entities) since prior-art candidates aren't shared with
 * other subgraphs.
 */
import gql from 'graphql-tag';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { findPriorArt } from '../../lib/integrations/github';
import {
  searchGithubRepos,
  searchResearchPapers,
  searchNews
} from '../../lib/integrations/tinyfish';

const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key"])

  type PriorArtCandidate {
    repo: String!
    url: String!
    firstCommitDate: String!
    stars: Int!
    evidenceSnippet: String!
    predatesPriorityDate: Boolean!
  }

  type ResearchPaper {
    title: String!
    url: String!
    snippet: String!
    source: String!
    arxivId: String
  }

  type NewsHit {
    title: String!
    url: String!
    snippet: String!
    source: String!
    publishedDate: String
  }

  type Query {
    githubPriorArt(
      claimSummary: String!
      priorityDate: String!
      limit: Int
    ): [PriorArtCandidate!]!
    tinyfishGithubRepos(
      query: String!
      priorityDate: String
      limit: Int
    ): [PriorArtCandidate!]!
    researchPapers(
      query: String!
      sites: [String!]
      limit: Int
    ): [ResearchPaper!]!
    tinyfishNews(
      query: String!
      sites: [String!]
      dateFrom: String
      limit: Int
    ): [NewsHit!]!
  }
`;

const resolvers = {
  Query: {
    githubPriorArt: (_: unknown, args: any) => findPriorArt(args),
    tinyfishGithubRepos: (_: unknown, args: any) => searchGithubRepos(args),
    researchPapers: (_: unknown, args: any) => searchResearchPapers(args),
    tinyfishNews: (_: unknown, args: any) => searchNews(args)
  }
};

export const priorartSchema = buildSubgraphSchema({ typeDefs, resolvers });
