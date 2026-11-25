-- Kitchen Note & Modifiers Support for Printing
-- Run this in Supabase SQL Editor (after 20251126_printers.sql)

-- 1. Add kitchen_note to transaction_items if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transaction_items' AND column_name = 'kitchen_note'
    ) THEN
        ALTER TABLE transaction_items ADD COLUMN kitchen_note TEXT;
        COMMENT ON COLUMN transaction_items.kitchen_note IS 'Catatan khusus untuk dapur (tanpa cabe, extra keju, dll)';
    END IF;
END $$;

-- 2. Create transaction_item_modifiers table if not exists
CREATE TABLE IF NOT EXISTS transaction_item_modifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_item_id UUID NOT NULL REFERENCES transaction_items(id) ON DELETE CASCADE,
    modifier_id UUID NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
    modifier_name TEXT NOT NULL, -- denormalized for printing
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tim_transaction_item ON transaction_item_modifiers(transaction_item_id);

-- 3. RLS for transaction_item_modifiers
ALTER TABLE transaction_item_modifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for transaction_item_modifiers" ON transaction_item_modifiers
    FOR ALL
    USING (
        transaction_item_id IN (
            SELECT ti.id FROM transaction_items ti
            JOIN transactions t ON t.id = ti.transaction_id
            WHERE t.tenant_id IN (
                SELECT tenant_id FROM profiles WHERE id = auth.uid()
            )
        )
    )
    WITH CHECK (
        transaction_item_id IN (
            SELECT ti.id FROM transaction_items ti
            JOIN transactions t ON t.id = ti.transaction_id
            WHERE t.tenant_id IN (
                SELECT tenant_id FROM profiles WHERE id = auth.uid()
            )
        )
    );

-- 4. Ensure products table has category for kitchen filtering
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'category'
    ) THEN
        ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'food';
        COMMENT ON COLUMN products.category IS 'Kategori: food, drink, dessert, dll. Dipakai filter tiket dapur';
    END IF;
END $$;

-- 5. Add index for category
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- 6. Add queue_number to transactions if not exists (for take-away)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transactions' AND column_name = 'queue_number'
    ) THEN
        ALTER TABLE transactions ADD COLUMN queue_number INTEGER;
        COMMENT ON COLUMN transactions.queue_number IS 'Nomor antrian untuk take-away (cetak di tiket dapur & struk)';
    END IF;
END $$;

-- 7. Function to generate next queue number
CREATE OR REPLACE FUNCTION get_next_queue_number(p_tenant_id UUID, p_branch_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_next INT;
BEGIN
    SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_next
    FROM transactions
    WHERE tenant_id = p_tenant_id
      AND branch_id = p_branch_id
      AND queue_number IS NOT NULL
      AND DATE(created_at) = CURRENT_DATE;

    RETURN v_next;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_next_queue_number(UUID, UUID) TO authenticated;