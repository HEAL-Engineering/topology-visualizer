"""HEAL Daily Pages — V0 hackathon scaffold.

Per-user-day indexing for behavioral, semantic, and lexical retrieval over
wearable / financial / email / messages sources.

V0 ships infrastructure only: schema, redaction harness, source-adapter
boundary, fixture adapter, and writer plumbing. Extractors / embeddings /
LLM calls / trajectory / interventions land in V1+.

See DESIGN.md for the full decisions matrix.
"""

__version__ = "0.1.0"
