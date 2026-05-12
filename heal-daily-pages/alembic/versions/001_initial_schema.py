"""initial v3 schema — daily_pages, centroids, action_templates, interventions, backfill, quarantine

Revision ID: 001
Revises:
Create Date: 2026-05-06
"""

from __future__ import annotations

from alembic import op

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.execute(
        """
        CREATE TABLE daily_pages (
          user_id              UUID NOT NULL,
          date                 DATE NOT NULL,
          base_features        VECTOR(240),
          trajectory_features  VECTOR(60),
          text_embed           VECTOR(768),
          page_text            TEXT NOT NULL DEFAULT '',
          page_tsv             TSVECTOR GENERATED ALWAYS AS
                                 (to_tsvector('english', page_text)) STORED,
          data_signature       JSONB NOT NULL DEFAULT '{}'::jsonb,
          metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at           TIMESTAMPTZ DEFAULT now(),
          updated_at           TIMESTAMPTZ DEFAULT now(),
          PRIMARY KEY (user_id, date)
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_daily_base_features ON daily_pages "
        "USING hnsw (base_features vector_cosine_ops)"
    )
    op.execute(
        "CREATE INDEX idx_daily_trajectory_features ON daily_pages "
        "USING hnsw (trajectory_features vector_cosine_ops)"
    )
    op.execute(
        "CREATE INDEX idx_daily_text_embed ON daily_pages "
        "USING hnsw (text_embed vector_cosine_ops)"
    )
    op.execute("CREATE INDEX idx_daily_tsv ON daily_pages USING gin (page_tsv)")
    op.execute("CREATE INDEX idx_daily_metadata ON daily_pages USING gin (metadata)")

    op.execute(
        """
        CREATE TABLE user_centroids (
          user_id              UUID NOT NULL,
          centroid_type        TEXT NOT NULL,
          computed_at          TIMESTAMPTZ NOT NULL,
          base_features        VECTOR(240),
          trajectory_features  VECTOR(60),
          metadata             JSONB,
          PRIMARY KEY (user_id, centroid_type, computed_at)
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_centroids_user_type ON user_centroids "
        "(user_id, centroid_type, computed_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE action_templates (
          template_id              TEXT PRIMARY KEY,
          template_version         INT NOT NULL DEFAULT 1,
          title_template           TEXT NOT NULL,
          rationale_template       TEXT NOT NULL,
          expected_base_delta      VECTOR(240) NOT NULL,
          expected_trajectory_delta VECTOR(60),
          expected_delta_source    TEXT NOT NULL DEFAULT 'curated'
                                     CHECK (expected_delta_source IN ('curated','empirical')),
          wheel_dimensions         TEXT[] NOT NULL,
          default_urgency          TEXT NOT NULL
                                     CHECK (default_urgency IN ('low','medium','high','critical')),
          valid_window_hours       INT NOT NULL,
          effort_estimate          TEXT CHECK (effort_estimate IN ('low','medium','high')),
          metadata                 JSONB,
          created_at               TIMESTAMPTZ DEFAULT now(),
          updated_at               TIMESTAMPTZ DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE interventions (
          intervention_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id                      UUID NOT NULL,
          action_template_id           TEXT NOT NULL REFERENCES action_templates(template_id),
          generated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
          valid_from                   TIMESTAMPTZ NOT NULL,
          valid_to                     TIMESTAMPTZ NOT NULL,
          urgency                      TEXT NOT NULL
                                         CHECK (urgency IN ('low','medium','high','critical')),
          priority_score               FLOAT NOT NULL,
          current_base_centroid        VECTOR(240),
          current_trajectory_centroid  VECTOR(60),
          target_base_centroid         VECTOR(240),
          target_trajectory_centroid   VECTOR(60),
          expected_base_delta          VECTOR(240),
          expected_trajectory_delta    VECTOR(60),
          observed_base_delta          VECTOR(240),
          observed_trajectory_delta    VECTOR(60),
          wheel_dimensions             TEXT[] NOT NULL,
          title                        TEXT NOT NULL,
          rationale                    TEXT NOT NULL,
          effort_estimate              TEXT CHECK (effort_estimate IN ('low','medium','high')),
          status                       TEXT NOT NULL DEFAULT 'pending'
                                         CHECK (status IN ('pending','accepted','completed','dismissed','expired')),
          status_changed_at            TIMESTAMPTZ,
          outcome_score                FLOAT,
          exclusion_group_id           TEXT,
          depends_on                   UUID REFERENCES interventions(intervention_id),
          metadata                     JSONB
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_interventions_user_active ON interventions "
        "(user_id, status, valid_to) WHERE status IN ('pending','accepted')"
    )
    op.execute(
        "CREATE INDEX idx_interventions_user_generated ON interventions "
        "(user_id, generated_at DESC)"
    )
    op.execute(
        "CREATE INDEX idx_interventions_exclusion_group ON interventions "
        "(exclusion_group_id) WHERE exclusion_group_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX idx_interventions_depends_on ON interventions "
        "(depends_on) WHERE depends_on IS NOT NULL"
    )

    op.execute(
        """
        CREATE TABLE backfill_progress (
          user_id               UUID NOT NULL,
          source                TEXT NOT NULL
                                  CHECK (source IN ('wearable','financial','email','messages')),
          last_completed_date   DATE,
          status                TEXT NOT NULL
                                  CHECK (status IN ('pending','running','completed','failed')),
          started_at            TIMESTAMPTZ,
          finished_at           TIMESTAMPTZ,
          error                 TEXT,
          PRIMARY KEY (user_id, source)
        )
        """
    )

    op.execute(
        """
        CREATE TABLE daily_pages_quarantine (
          quarantine_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id              UUID NOT NULL,
          date                 DATE NOT NULL,
          raw_redacted_text    TEXT NOT NULL,
          validator_findings   JSONB NOT NULL,
          created_at           TIMESTAMPTZ DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_quarantine_user_date ON daily_pages_quarantine (user_id, date)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS daily_pages_quarantine")
    op.execute("DROP TABLE IF EXISTS backfill_progress")
    op.execute("DROP TABLE IF EXISTS interventions")
    op.execute("DROP TABLE IF EXISTS action_templates")
    op.execute("DROP TABLE IF EXISTS user_centroids")
    op.execute("DROP TABLE IF EXISTS daily_pages")
