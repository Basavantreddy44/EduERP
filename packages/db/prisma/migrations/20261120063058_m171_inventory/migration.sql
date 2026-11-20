-- AlterTable
ALTER TABLE "vendor_bill_items" ADD COLUMN     "goods_receipt_item_id" UUID;

-- CreateTable
CREATE TABLE "item_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category_id" UUID NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "item_type" VARCHAR(15) NOT NULL,
    "hsn_code" VARCHAR(10),
    "tax_code_id" UUID,
    "reorder_level" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expense_account_id" UUID,
    "description" VARCHAR(300),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "store_keeper_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "avg_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "last_low_alert" DATE,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "txn_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txn_date" DATE NOT NULL,
    "txn_type" VARCHAR(15) NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(14,4) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "reference_type" VARCHAR(15) NOT NULL,
    "reference_id" UUID,
    "balance_after" DECIMAL(14,2) NOT NULL,
    "value_after" DECIMAL(14,2) NOT NULL,
    "remarks" VARCHAR(200),
    "created_by" UUID,

    CONSTRAINT "stock_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "pr_no" VARCHAR(30) NOT NULL,
    "department_id" UUID NOT NULL,
    "department_request_id" UUID,
    "requested_by" UUID NOT NULL,
    "required_by" DATE,
    "justification" VARCHAR(500) NOT NULL,
    "estimated_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approval_request_id" UUID,
    "status" VARCHAR(15) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pr_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL,
    "estimated_rate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remarks" VARCHAR(200),

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pr_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "quotation_no" VARCHAR(50),
    "quotation_date" DATE NOT NULL,
    "valid_till" DATE,
    "delivery_days" SMALLINT,
    "payment_terms" VARCHAR(200),
    "sub_total" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "selection_reason" VARCHAR(300),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "pr_item_id" UUID NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "tax_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "po_no" VARCHAR(30) NOT NULL,
    "vendor_id" UUID NOT NULL,
    "pr_id" UUID,
    "quotation_id" UUID,
    "po_date" DATE NOT NULL,
    "delivery_date" DATE,
    "store_id" UUID NOT NULL,
    "sub_total" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "terms" VARCHAR(2000),
    "approval_request_id" UUID,
    "status" VARCHAR(20) NOT NULL,
    "cancel_reason" VARCHAR(300),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "tax_code_id" UUID,
    "tax_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "received_qty" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "grn_no" VARCHAR(30) NOT NULL,
    "po_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "receipt_date" DATE NOT NULL,
    "vendor_challan_no" VARCHAR(50),
    "received_by" UUID NOT NULL,
    "remarks" VARCHAR(300),
    "status" VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "grn_id" UUID NOT NULL,
    "po_item_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "received_qty" DECIMAL(14,2) NOT NULL,
    "accepted_qty" DECIMAL(14,2) NOT NULL,
    "rejected_qty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rejection_reason" VARCHAR(200),
    "rate" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_issues" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "issue_no" VARCHAR(30) NOT NULL,
    "issue_type" VARCHAR(10) NOT NULL,
    "from_store_id" UUID NOT NULL,
    "to_store_id" UUID,
    "to_department_id" UUID,
    "department_request_id" UUID,
    "issued_to_employee_id" UUID,
    "issue_date" DATE NOT NULL,
    "total_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remarks" VARCHAR(300),
    "status" VARCHAR(10) NOT NULL DEFAULT 'ISSUED',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_issue_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(14,4) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "returnable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "stock_issue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "count_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "approval_request_id" UUID,
    "remarks" VARCHAR(300),
    "created_by" UUID NOT NULL,
    "adjusted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "system_qty" DECIMAL(14,2) NOT NULL,
    "counted_qty" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(14,4) NOT NULL,
    "remarks" VARCHAR(200),

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_categories_tenant_id_id_key" ON "item_categories"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "item_categories_tenant_id_name_key" ON "item_categories"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenant_id_id_key" ON "inventory_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenant_id_item_code_key" ON "inventory_items"("tenant_id", "item_code");

-- CreateIndex
CREATE UNIQUE INDEX "stores_tenant_id_id_key" ON "stores"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_tenant_id_campus_id_name_key" ON "stores"("tenant_id", "campus_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_tenant_id_id_key" ON "stock_balances"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_store_id_item_id_key" ON "stock_balances"("store_id", "item_id");

-- CreateIndex
CREATE INDEX "stock_transactions_tenant_id_item_id_txn_at_idx" ON "stock_transactions"("tenant_id", "item_id", "txn_at");

-- CreateIndex
CREATE INDEX "stock_transactions_tenant_id_store_id_txn_at_idx" ON "stock_transactions"("tenant_id", "store_id", "txn_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transactions_tenant_id_id_key" ON "stock_transactions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "purchase_requests_tenant_id_status_idx" ON "purchase_requests"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_tenant_id_id_key" ON "purchase_requests"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_tenant_id_pr_no_key" ON "purchase_requests"("tenant_id", "pr_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_request_items_tenant_id_id_key" ON "purchase_request_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_request_items_pr_id_item_id_key" ON "purchase_request_items"("pr_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_tenant_id_id_key" ON "quotations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_pr_id_vendor_id_key" ON "quotations"("pr_id", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_items_tenant_id_id_key" ON "quotation_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_items_quotation_id_pr_item_id_key" ON "quotation_items"("quotation_id", "pr_item_id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_status_idx" ON "purchase_orders"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_id_key" ON "purchase_orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_po_no_key" ON "purchase_orders"("tenant_id", "po_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_tenant_id_id_key" ON "purchase_order_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_po_id_line_no_key" ON "purchase_order_items"("po_id", "line_no");

-- CreateIndex
CREATE INDEX "goods_receipts_tenant_id_po_id_idx" ON "goods_receipts"("tenant_id", "po_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_id_key" ON "goods_receipts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_grn_no_key" ON "goods_receipts"("tenant_id", "grn_no");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_items_tenant_id_id_key" ON "goods_receipt_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_items_grn_id_po_item_id_key" ON "goods_receipt_items"("grn_id", "po_item_id");

-- CreateIndex
CREATE INDEX "stock_issues_tenant_id_issue_date_idx" ON "stock_issues"("tenant_id", "issue_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_issues_tenant_id_id_key" ON "stock_issues"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_issues_tenant_id_issue_no_key" ON "stock_issues"("tenant_id", "issue_no");

-- CreateIndex
CREATE UNIQUE INDEX "stock_issue_items_tenant_id_id_key" ON "stock_issue_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_issue_items_issue_id_item_id_key" ON "stock_issue_items"("issue_id", "item_id");

-- CreateIndex
CREATE INDEX "stock_counts_tenant_id_store_id_idx" ON "stock_counts"("tenant_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_tenant_id_id_key" ON "stock_counts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_tenant_id_id_key" ON "stock_count_lines"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_count_id_item_id_key" ON "stock_count_lines"("count_id", "item_id");

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_tenant_id_pr_id_fkey" FOREIGN KEY ("tenant_id", "pr_id") REFERENCES "purchase_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_tenant_id_quotation_id_fkey" FOREIGN KEY ("tenant_id", "quotation_id") REFERENCES "quotations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_id_po_id_fkey" FOREIGN KEY ("tenant_id", "po_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_tenant_id_grn_id_fkey" FOREIGN KEY ("tenant_id", "grn_id") REFERENCES "goods_receipts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issue_items" ADD CONSTRAINT "stock_issue_items_tenant_id_issue_id_fkey" FOREIGN KEY ("tenant_id", "issue_id") REFERENCES "stock_issues"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_tenant_id_count_id_fkey" FOREIGN KEY ("tenant_id", "count_id") REFERENCES "stock_counts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written section (not expressible in schema.prisma). Review on every change.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tenant-safe links.
ALTER TABLE "item_categories" ADD CONSTRAINT item_categories_parent_fkey FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "item_categories"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "inventory_items" ADD CONSTRAINT inventory_items_category_fkey FOREIGN KEY ("tenant_id", "category_id") REFERENCES "item_categories"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "inventory_items" ADD CONSTRAINT inventory_items_tax_fkey FOREIGN KEY ("tenant_id", "tax_code_id") REFERENCES "tax_codes"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "inventory_items" ADD CONSTRAINT inventory_items_account_fkey FOREIGN KEY ("tenant_id", "expense_account_id") REFERENCES "accounts"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stores" ADD CONSTRAINT stores_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stores" ADD CONSTRAINT stores_keeper_fkey FOREIGN KEY ("tenant_id", "store_keeper_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_balances" ADD CONSTRAINT stock_balances_store_fkey FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_balances" ADD CONSTRAINT stock_balances_item_fkey FOREIGN KEY ("tenant_id", "item_id") REFERENCES "inventory_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_transactions" ADD CONSTRAINT stock_txn_store_fkey FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_transactions" ADD CONSTRAINT stock_txn_item_fkey FOREIGN KEY ("tenant_id", "item_id") REFERENCES "inventory_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_requests" ADD CONSTRAINT pr_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_requests" ADD CONSTRAINT pr_department_fkey FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_requests" ADD CONSTRAINT pr_dept_request_fkey FOREIGN KEY ("tenant_id", "department_request_id") REFERENCES "department_requests"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_request_items" ADD CONSTRAINT pr_items_item_fkey FOREIGN KEY ("tenant_id", "item_id") REFERENCES "inventory_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "quotations" ADD CONSTRAINT quotations_pr_fkey FOREIGN KEY ("tenant_id", "pr_id") REFERENCES "purchase_requests"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "quotations" ADD CONSTRAINT quotations_vendor_fkey FOREIGN KEY ("tenant_id", "vendor_id") REFERENCES "vendors"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "quotation_items" ADD CONSTRAINT quotation_items_pr_item_fkey FOREIGN KEY ("tenant_id", "pr_item_id") REFERENCES "purchase_request_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_orders" ADD CONSTRAINT po_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_orders" ADD CONSTRAINT po_vendor_fkey FOREIGN KEY ("tenant_id", "vendor_id") REFERENCES "vendors"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_orders" ADD CONSTRAINT po_pr_fkey FOREIGN KEY ("tenant_id", "pr_id") REFERENCES "purchase_requests"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_orders" ADD CONSTRAINT po_quotation_fkey FOREIGN KEY ("tenant_id", "quotation_id") REFERENCES "quotations"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_orders" ADD CONSTRAINT po_store_fkey FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT po_items_item_fkey FOREIGN KEY ("tenant_id", "item_id") REFERENCES "inventory_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT po_items_tax_fkey FOREIGN KEY ("tenant_id", "tax_code_id") REFERENCES "tax_codes"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "goods_receipts" ADD CONSTRAINT grn_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "goods_receipts" ADD CONSTRAINT grn_po_fkey FOREIGN KEY ("tenant_id", "po_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "goods_receipts" ADD CONSTRAINT grn_store_fkey FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT grn_items_po_item_fkey FOREIGN KEY ("tenant_id", "po_item_id") REFERENCES "purchase_order_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT grn_items_item_fkey FOREIGN KEY ("tenant_id", "item_id") REFERENCES "inventory_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_issues" ADD CONSTRAINT issues_campus_fkey FOREIGN KEY ("tenant_id", "campus_id") REFERENCES "campuses"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_issues" ADD CONSTRAINT issues_from_fkey FOREIGN KEY ("tenant_id", "from_store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_issues" ADD CONSTRAINT issues_to_fkey FOREIGN KEY ("tenant_id", "to_store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_issues" ADD CONSTRAINT issues_dept_fkey FOREIGN KEY ("tenant_id", "to_department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_issues" ADD CONSTRAINT issues_dept_req_fkey FOREIGN KEY ("tenant_id", "department_request_id") REFERENCES "department_requests"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_issues" ADD CONSTRAINT issues_employee_fkey FOREIGN KEY ("tenant_id", "issued_to_employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_issue_items" ADD CONSTRAINT issue_items_item_fkey FOREIGN KEY ("tenant_id", "item_id") REFERENCES "inventory_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_counts" ADD CONSTRAINT counts_store_fkey FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT count_lines_item_fkey FOREIGN KEY ("tenant_id", "item_id") REFERENCES "inventory_items"("tenant_id", "id") ON DELETE RESTRICT;
-- Vendor bills made from a goods receipt keep the receipt line they bill (3-way match).
ALTER TABLE "vendor_bill_items" ADD CONSTRAINT bill_items_grn_item_fkey FOREIGN KEY ("tenant_id", "goods_receipt_item_id") REFERENCES "goods_receipt_items"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_bills" ADD CONSTRAINT vendor_bills_po_fkey FOREIGN KEY ("tenant_id", "purchase_order_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE RESTRICT;
ALTER TABLE "vendor_bills" ADD CONSTRAINT vendor_bills_grn_fkey FOREIGN KEY ("tenant_id", "goods_receipt_id") REFERENCES "goods_receipts"("tenant_id", "id") ON DELETE RESTRICT;

-- Allowed values and shapes.
ALTER TABLE "inventory_items" ADD CONSTRAINT inventory_items_chk CHECK (item_type IN ('CONSUMABLE','ASSET','LAB_EQUIPMENT') AND reorder_level >= 0 AND item_code ~ '^[A-Z0-9][A-Z0-9/_-]*$');
-- Stock never goes below zero; value follows quantity.
ALTER TABLE "stock_balances" ADD CONSTRAINT stock_balances_chk CHECK (quantity >= 0 AND avg_cost >= 0 AND value >= 0 AND (quantity > 0 OR value = 0));
ALTER TABLE "stock_transactions" ADD CONSTRAINT stock_txn_chk CHECK (
  txn_type IN ('OPENING','GRN_IN','ISSUE_OUT','TRANSFER_OUT','TRANSFER_IN','ADJUST_IN','ADJUST_OUT')
  AND reference_type IN ('OPENING','GRN','ISSUE','TRANSFER','COUNT')
  AND quantity > 0 AND rate >= 0 AND value >= 0 AND balance_after >= 0 AND value_after >= 0);
ALTER TABLE "purchase_requests" ADD CONSTRAINT pr_chk CHECK (status IN ('SUBMITTED','APPROVED','REJECTED','ORDERED','CANCELLED') AND estimated_total >= 0);
ALTER TABLE "purchase_request_items" ADD CONSTRAINT pr_items_chk CHECK (quantity > 0 AND estimated_rate >= 0);
ALTER TABLE "quotations" ADD CONSTRAINT quotations_chk CHECK (sub_total >= 0 AND tax_amount >= 0 AND total_amount = sub_total + tax_amount AND (delivery_days IS NULL OR delivery_days >= 0) AND (valid_till IS NULL OR valid_till >= quotation_date));
-- One selected quotation per request.
CREATE UNIQUE INDEX quotations_selected_uq ON "quotations" ("tenant_id", "pr_id") WHERE is_selected;
ALTER TABLE "quotation_items" ADD CONSTRAINT quotation_items_chk CHECK (rate >= 0 AND tax_percent BETWEEN 0 AND 100 AND amount >= 0);
ALTER TABLE "purchase_orders" ADD CONSTRAINT po_chk CHECK (
  status IN ('PENDING_APPROVAL','APPROVED','PARTIAL','RECEIVED','CLOSED','CANCELLED','REJECTED')
  AND sub_total >= 0 AND tax_amount >= 0 AND total_amount = sub_total + tax_amount AND (delivery_date IS NULL OR delivery_date >= po_date));
-- Received up to the ordered quantity + 5%.
ALTER TABLE "purchase_order_items" ADD CONSTRAINT po_items_chk CHECK (quantity > 0 AND rate >= 0 AND tax_percent BETWEEN 0 AND 100 AND amount >= 0 AND tax_amount >= 0 AND received_qty >= 0 AND received_qty <= quantity * 1.05);
ALTER TABLE "goods_receipts" ADD CONSTRAINT grn_chk CHECK (status IN ('POSTED'));
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT grn_items_chk CHECK (received_qty > 0 AND accepted_qty >= 0 AND rejected_qty >= 0 AND accepted_qty + rejected_qty = received_qty AND rate >= 0 AND (rejected_qty = 0 OR rejection_reason IS NOT NULL));
ALTER TABLE "stock_issues" ADD CONSTRAINT issues_chk CHECK (
  issue_type IN ('ISSUE','TRANSFER') AND status IN ('ISSUED','CANCELLED') AND total_value >= 0
  AND (issue_type <> 'TRANSFER' OR (to_store_id IS NOT NULL AND to_store_id <> from_store_id))
  AND (issue_type <> 'ISSUE' OR to_department_id IS NOT NULL OR issued_to_employee_id IS NOT NULL));
ALTER TABLE "stock_issue_items" ADD CONSTRAINT issue_items_chk CHECK (quantity > 0 AND rate >= 0 AND value >= 0);
ALTER TABLE "stock_counts" ADD CONSTRAINT counts_chk CHECK (status IN ('PENDING_APPROVAL','ADJUSTED','REJECTED') AND (status <> 'ADJUSTED' OR adjusted_at IS NOT NULL));
ALTER TABLE "stock_count_lines" ADD CONSTRAINT count_lines_chk CHECK (system_qty >= 0 AND counted_qty >= 0 AND difference = counted_qty - system_qty AND rate >= 0);

-- The stock ledger is append-only.
CREATE OR REPLACE FUNCTION stock_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The stock ledger cannot be changed — record a new movement instead' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER stock_transactions_append_only BEFORE UPDATE OR DELETE ON "stock_transactions" FOR EACH ROW EXECUTE FUNCTION stock_ledger_append_only();

-- Tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_categories','inventory_items','stores','stock_balances','stock_transactions','purchase_requests','purchase_request_items','quotations','quotation_items','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items','stock_issues','stock_issue_items','stock_counts','stock_count_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Records are never deleted (items and stores are switched off; orders cancelled).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduerp_app') THEN
    REVOKE DELETE, TRUNCATE ON "item_categories", "inventory_items", "stores", "stock_balances", "stock_transactions", "purchase_requests", "purchase_request_items", "quotations", "quotation_items", "purchase_orders", "purchase_order_items", "goods_receipts", "goods_receipt_items", "stock_issues", "stock_issue_items", "stock_counts", "stock_count_lines" FROM eduerp_app;
  END IF;
END $$;
