-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('uploaded', 'parsing', 'extracting', 'reconciling', 'needs_review', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "ErrorCode" AS ENUM ('not_a_statement', 'password_required', 'incorrect_password', 'no_text_layer', 'unreadable_file', 'multiple_statements', 'file_too_large', 'extraction_failed');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "FlagType" AS ENUM ('running_balance_break', 'page_boundary_gap', 'unverifiable_row', 'arithmetic_mismatch', 'duplicate_suspect', 'missing_field');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('info', 'warning', 'error');

-- CreateTable
CREATE TABLE "statements" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "file_bytes" INTEGER NOT NULL,
    "status" "StatementStatus" NOT NULL DEFAULT 'uploaded',
    "error_code" "ErrorCode",
    "error_detail" TEXT,
    "page_count" INTEGER,
    "bank_name" TEXT,
    "account_number_masked" TEXT,
    "period_start" DATE,
    "period_end" DATE,
    "opening_balance" DECIMAL(18,2),
    "closing_balance" DECIMAL(18,2),
    "currency" VARCHAR(3),
    "raw_extraction" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "row_index" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "direction" "Direction" NOT NULL,
    "running_balance" DECIMAL(18,2),
    "source_page" INTEGER,
    "source_bbox" JSONB,
    "bbox_match_confidence" DOUBLE PRECISION,
    "is_corrected" BOOLEAN NOT NULL DEFAULT false,
    "original_values" JSONB,
    "corrected_at" TIMESTAMP(3),
    "search_vector" tsvector,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "expected_delta" DECIMAL(18,2) NOT NULL,
    "actual_delta" DECIMAL(18,2) NOT NULL,
    "discrepancy" DECIMAL(18,2) NOT NULL,
    "is_reconciled" BOOLEAN NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flags" (
    "id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "transaction_id" UUID,
    "flag_type" "FlagType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "detail" TEXT NOT NULL,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "statements_workspace_id_created_at_idx" ON "statements"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "transactions_statement_id_date_idx" ON "transactions"("statement_id", "date");

-- CreateIndex
CREATE INDEX "transactions_statement_id_amount_idx" ON "transactions"("statement_id", "amount");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_statement_id_row_index_key" ON "transactions"("statement_id", "row_index");

-- CreateIndex
CREATE INDEX "reconciliations_statement_id_run_at_idx" ON "reconciliations"("statement_id", "run_at");

-- CreateIndex
CREATE INDEX "flags_statement_id_is_resolved_idx" ON "flags"("statement_id", "is_resolved");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flags" ADD CONSTRAINT "flags_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flags" ADD CONSTRAINT "flags_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
