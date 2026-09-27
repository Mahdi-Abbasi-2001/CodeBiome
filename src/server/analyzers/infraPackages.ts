/**
 * A curated, deterministic lookup from well-known package/module names to
 * the real-world technology they represent — the ONLY way the Repository
 * Knowledge Model can currently know "this repo talks to MySQL" vs. "this
 * repo talks to Redis" vs. "this repo calls Stripe". Never inferred by an
 * LLM: a bare `import "mysql2"` (or Python `import psycopg2`) is as
 * deterministic a fact as any other edge in this model.
 *
 * Deliberately conservative: generic HTTP clients (axios, requests,
 * node-fetch) are NOT listed here, because importing one says nothing
 * about which external system is on the other end — that would be a
 * fabricated node, not a real one. Only libraries whose name itself names
 * the technology are included.
 */
export type ExternalCategory = "database" | "cache" | "queue" | "search" | "external-api" | "frontend" | "backend" | "fullstack";

export interface ExternalPackageInfo {
  name: string;
  category: ExternalCategory;
}

export interface ExternalPackageMatch extends ExternalPackageInfo {
  /** Canonical package id — the root package name, subpaths stripped. */
  id: string;
}

const PACKAGE_TABLE: Record<string, ExternalPackageInfo> = {
  // databases (drivers and ORMs — an ORM import is still real evidence "this app talks to a database")
  mysql: { name: "MySQL", category: "database" },
  mysql2: { name: "MySQL", category: "database" },
  pg: { name: "PostgreSQL", category: "database" },
  "pg-promise": { name: "PostgreSQL", category: "database" },
  psycopg2: { name: "PostgreSQL", category: "database" },
  asyncpg: { name: "PostgreSQL", category: "database" },
  mongodb: { name: "MongoDB", category: "database" },
  mongoose: { name: "MongoDB", category: "database" },
  pymongo: { name: "MongoDB", category: "database" },
  sqlite3: { name: "SQLite", category: "database" },
  "better-sqlite3": { name: "SQLite", category: "database" },
  typeorm: { name: "TypeORM", category: "database" },
  sequelize: { name: "Sequelize", category: "database" },
  prisma: { name: "Prisma", category: "database" },
  "@prisma/client": { name: "Prisma", category: "database" },
  knex: { name: "Knex", category: "database" },
  sqlalchemy: { name: "SQLAlchemy", category: "database" },
  django_orm: { name: "Django ORM", category: "database" },

  // caches
  redis: { name: "Redis", category: "cache" },
  ioredis: { name: "Redis", category: "cache" },
  memcached: { name: "Memcached", category: "cache" },
  pymemcache: { name: "Memcached", category: "cache" },

  // queues / message brokers
  amqplib: { name: "RabbitMQ", category: "queue" },
  "amqp-connection-manager": { name: "RabbitMQ", category: "queue" },
  pika: { name: "RabbitMQ", category: "queue" },
  kafkajs: { name: "Kafka", category: "queue" },
  "node-rdkafka": { name: "Kafka", category: "queue" },
  "kafka-python": { name: "Kafka", category: "queue" },
  bull: { name: "Bull Queue", category: "queue" },
  bullmq: { name: "BullMQ", category: "queue" },
  celery: { name: "Celery", category: "queue" },

  // search
  "@elastic/elasticsearch": { name: "Elasticsearch", category: "search" },
  elasticsearch: { name: "Elasticsearch", category: "search" },
  algoliasearch: { name: "Algolia", category: "search" },

  // external / third-party service SDKs
  stripe: { name: "Stripe", category: "external-api" },
  twilio: { name: "Twilio", category: "external-api" },
  "@sendgrid/mail": { name: "SendGrid", category: "external-api" },
  sendgrid: { name: "SendGrid", category: "external-api" },
  "aws-sdk": { name: "AWS", category: "external-api" },
  boto3: { name: "AWS", category: "external-api" },
  googleapis: { name: "Google APIs", category: "external-api" },
  "firebase-admin": { name: "Firebase", category: "external-api" },

  // frontend frameworks
  react: { name: "React", category: "frontend" },
  "react-dom": { name: "React", category: "frontend" },
  vue: { name: "Vue", category: "frontend" },
  "@angular/core": { name: "Angular", category: "frontend" },
  svelte: { name: "Svelte", category: "frontend" },
  next: { name: "Next.js", category: "fullstack" },

  // backend frameworks
  express: { name: "Express", category: "backend" },
  "@nestjs/core": { name: "NestJS", category: "backend" },
  fastify: { name: "Fastify", category: "backend" },
  koa: { name: "Koa", category: "backend" },
  "@hapi/hapi": { name: "Hapi", category: "backend" },
  django: { name: "Django", category: "backend" },
  flask: { name: "Flask", category: "backend" },
  fastapi: { name: "FastAPI", category: "backend" },
};

function packageRoot(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

/** For a bare (non-relative) import specifier that failed to resolve to an internal file, checks whether it names a known technology. */
export function matchExternalPackage(specifier: string): ExternalPackageMatch | null {
  const id = packageRoot(specifier);
  const entry = PACKAGE_TABLE[id];
  return entry ? { id, ...entry } : null;
}

export function lookupExternalPackage(id: string): ExternalPackageInfo | null {
  return PACKAGE_TABLE[id] ?? null;
}
