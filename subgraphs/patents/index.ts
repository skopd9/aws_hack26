/**
 * `patents` subgraph (port 4001).
 *
 * Owns the `Patent` federated entity (`@key(fields: "patentNo")`) and the
 * authoritative patent-search / claim-text / citations / PTAB-history /
 * Nexla-feed / Ghost-cache surfaces. Other subgraphs (notably `analysis`)
 * extend `Patent` with their own fields — the Cosmo Router stitches them.
 */
import gql from 'graphql-tag';
import { buildSubgraphSchema } from '@apollo/subgraph';
import {
  searchUspto,
  getClaimText,
  getCitations,
  getPtabHistory
} from '../../lib/integrations/uspto';
import { searchPatents as searchGooglePatents } from '../../lib/integrations/googlePatents';
import { latestFilings } from '../../lib/integrations/nexla';
import {
  upsertPatentEmbedding,
  similarPatents
} from '../../lib/integrations/ghost';
import { searchUsptoPubs } from '../../lib/integrations/tinyfish';
import {
  searchFileWrapper,
  getFileWrapperDetail
} from '../../lib/integrations/usptoOdp';

const typeDefs = gql`
  extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.7"
      import: ["@key", "@shareable"]
    )

  type Patent @key(fields: "patentNo") {
    patentNo: ID!
    title: String!
    abstract: String!
    assignee: String!
    priorityDate: String!
    cpcClasses: [String!]!
    url: String!
  }

  type ClaimText {
    patentNo: ID!
    claims: [String!]!
  }

  type Citations {
    patentNo: ID!
    backwardCitations: [String!]!
    forwardCitations: [String!]!
  }

  type IprPetition {
    petition: String!
    result: String!
  }

  type PtabHistory {
    patentNo: ID!
    iprPetitions: [IprPetition!]!
    claimsCancelled: [String!]!
  }

  type UpsertResult {
    ok: Boolean!
    id: String!
  }

  # ppubs.uspto.gov hit, optionally enriched with full claim text fetched
  # via TinyFish.  Distinct from \`Patent\` because it carries the kind
  # (granted vs application) and the raw claims block — useful as input
  # to akashml_summarizeClaim without a separate uspto_claim call.
  type UsptoPubHit {
    patentNo: ID!
    title: String!
    abstract: String!
    claimText: String!
    url: String!
    ppubsUrl: String!
    kind: String!
  }

  # USPTO Open Data Portal — Patent File Wrapper (PFW) bibliography.
  # Covers pending applications too (post-2001), unlike PatentsView.
  type FileWrapperBiblio {
    applicationNo: ID!
    inventionTitle: String!
    filingDate: String!
    publicationDate: String
    patentNumber: String
    grantDate: String
    statusDescription: String!
    assignee: String!
    applicantCountry: String!
    cpcClasses: [String!]!
    url: String!
  }

  type FileWrapperTransaction {
    date: String!
    code: String!
    description: String!
  }

  type FileWrapperDocument {
    documentCode: String!
    documentDescription: String!
    mailDate: String
    downloadUrl: String
  }

  type FileWrapperDetail {
    applicationNo: ID!
    inventionTitle: String!
    filingDate: String!
    publicationDate: String
    patentNumber: String
    grantDate: String
    statusDescription: String!
    assignee: String!
    applicantCountry: String!
    cpcClasses: [String!]!
    url: String!
    transactions: [FileWrapperTransaction!]!
    documents: [FileWrapperDocument!]!
    parentApplications: [String!]!
    childApplications: [String!]!
  }

  input PatentInput {
    patentNo: ID!
    title: String!
    abstract: String = ""
    assignee: String = ""
    priorityDate: String = ""
    cpcClasses: [String!] = []
    url: String = ""
  }

  type Query {
    usptoSearch(
      query: String!
      cpcClass: String
      dateFrom: String
      limit: Int
    ): [Patent!]!
    usptoClaim(patentNo: ID!): ClaimText!
    usptoCitations(patentNo: ID!): Citations!
    googlePatentsSearch(
      query: String!
      cpcClass: String
      dateFrom: String
      dateTo: String
      limit: Int
    ): [Patent!]!
    nexlaLatestFilings(since: String, limit: Int): [Patent!]!
    ptabHistory(patentNo: ID!): PtabHistory!
    ghostSimilarPatents(query: String!, limit: Int): [Patent!]!

    # Search ppubs.uspto.gov via TinyFish web search and (optionally) crawl
    # each result page for full claim text.  Covers pending applications
    # AND granted patents — fills the gap PatentsView leaves.
    tinyfishSearchUsptoPubs(
      query: String!
      dateFrom: String
      limit: Int
      fetchFullText: Boolean
    ): [UsptoPubHit!]!

    # USPTO Open Data Portal — Patent File Wrapper search.
    # Direct REST call to api.uspto.gov/api/v1/patent/applications/search
    # (the data.uspto.gov/apis/patent-file-wrapper/search endpoint).
    usptoFileWrapperSearch(
      query: String!
      dateFrom: String
      dateTo: String
      status: String
      limit: Int
    ): [FileWrapperBiblio!]!

    # Full prosecution history (transactions, documents, continuity) for a
    # known US application number.  Use after usptoFileWrapperSearch to
    # drill in on a specific filing.
    usptoFileWrapperDetail(applicationNo: ID!): FileWrapperDetail!
  }

  type Mutation {
    ghostCachePatent(patent: PatentInput!): UpsertResult!
  }
`;

const resolvers = {
  Patent: {
    // Other subgraphs (e.g. `analysis`) hand us a representation containing
    // only `patentNo`. Without a per-patent live lookup we just round-trip
    // the key — the requesting subgraph will only have asked for fields it
    // already has on its own copy of `Patent`.
    __resolveReference: (ref: { patentNo: string }) => ({
      patentNo: ref.patentNo,
      title: '',
      abstract: '',
      assignee: '',
      priorityDate: '',
      cpcClasses: [],
      url: ''
    })
  },
  Query: {
    usptoSearch: (_: unknown, args: any) => searchUspto(args),
    usptoClaim: (_: unknown, { patentNo }: { patentNo: string }) =>
      getClaimText(patentNo),
    usptoCitations: (_: unknown, { patentNo }: { patentNo: string }) =>
      getCitations(patentNo),
    googlePatentsSearch: (_: unknown, args: any) => searchGooglePatents(args),
    nexlaLatestFilings: (_: unknown, args: any) => latestFilings(args),
    ptabHistory: (_: unknown, { patentNo }: { patentNo: string }) =>
      getPtabHistory(patentNo),
    ghostSimilarPatents: (_: unknown, args: any) => similarPatents(args),
    tinyfishSearchUsptoPubs: (_: unknown, args: any) => searchUsptoPubs(args),
    usptoFileWrapperSearch: (_: unknown, args: any) => searchFileWrapper(args),
    usptoFileWrapperDetail: (
      _: unknown,
      { applicationNo }: { applicationNo: string }
    ) => getFileWrapperDetail(applicationNo)
  },
  Mutation: {
    ghostCachePatent: (_: unknown, { patent }: { patent: any }) =>
      upsertPatentEmbedding(patent)
  }
};

export const patentsSchema = buildSubgraphSchema({ typeDefs, resolvers });
