-- Printer Thermal Configuration for caPOS
-- Run this in Supabase SQL Editor

-- 1. Table: tenant_printers
CREATE TABLE IF NOT EXISTS tenant_printers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    connection TEXT NOT NULL CHECK (connection IN ('bluetooth', 'usb', 'network')),

    -- Bluetooth fields
    bluetooth_device_id TEXT,
    bluetooth_service_uuid TEXT,
    bluetooth_char_uuid TEXT,

    -- USB fields
    usb_vendor_id INTEGER,
    usb_product_id INTEGER,
    usb_interface_number INTEGER DEFAULT 0,
    usb_endpoint_out INTEGER DEFAULT 1,

    -- Network fields
    network_url TEXT,
    network_headers JSONB,

    -- Common settings
    paper_width INTEGER NOT NULL DEFAULT 58 CHECK (paper_width IN (58, 80)),
    charset TEXT NOT NULL DEFAULT 'cp858' CHECK (charset IN ('cp858', 'gb18030', 'utf8')),
    cut_after_print BOOLEAN NOT NULL DEFAULT true,
    is_default_receipt BOOLEAN NOT NULL DEFAULT false,
    is_default_kitchen BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Ensure only one default receipt and one default kitchen per tenant
    CONSTRAINT unique_default_receipt_per_tenant UNIQUE (tenant_id, is_default_receipt) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT unique_default_kitchen_per_tenant UNIQUE (tenant_id, is_default_kitchen) DEFERRABLE INITIALLY DEFERRED
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_printers_tenant ON tenant_printers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_printers_default_receipt ON tenant_printers(tenant_id, is_default_receipt) WHERE is_default_receipt = true;
CREATE INDEX IF NOT EXISTS idx_tenant_printers_default_kitchen ON tenant_printers(tenant_id, is_default_kitchen) WHERE is_default_kitchen = true;

-- 3. RLS Policies
ALTER TABLE tenant_printers ENABLE ROW LEVEL SECURITY;

-- Owner/Super Admin can manage all printers in their tenant
CREATE POLICY "Owner can manage printers" ON tenant_printers
    FOR ALL
    USING (
        tenant_id IN (
            SELECT tenant_id FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'super_admin')
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT tenant_id FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'super_admin')
        )
    );

-- Staff can view printers in their tenant (for POS printing)
CREATE POLICY "Staff can view printers" ON tenant_printers
    FOR SELECT
    USING (
        tenant_id IN (
            SELECT tenant_id FROM profiles WHERE id = auth.uid()
        )
    );

-- 4. Trigger for updated_at
CREATE OR REPLACE FUNCTION update_tenant_printers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_tenant_printers_updated_at ON tenant_printers;
CREATE TRIGGER trigger_tenant_printers_updated_at
    BEFORE UPDATE ON tenant_printers
    FOR EACH ROW
    EXECUTE FUNCTION update_tenant_printers_updated_at();

-- 5. Helper function: get default receipt printer for tenant
CREATE OR REPLACE FUNCTION get_default_receipt_printer(p_tenant_id UUID)
RETURNS tenant_printers AS $$
DECLARE
    v_printer tenant_printers;
BEGIN
    SELECT * INTO v_printer
    FROM tenant_printers
    WHERE tenant_id = p_tenant_id AND is_default_receipt = true
    LIMIT 1;

    -- Fallback: first printer
    IF v_printer IS NULL THEN
        SELECT * INTO v_printer
        FROM tenant_printers
        WHERE tenant_id = p_tenant_id
        ORDER BY created_at
        LIMIT 1;
    END IF;

    RETURN v_printer;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Helper function: get default kitchen printer for tenant
CREATE OR REPLACE FUNCTION get_default_kitchen_printer(p_tenant_id UUID)
RETURNS tenant_printers AS $$
DECLARE
    v_printer tenant_printers;
BEGIN
    SELECT * INTO v_printer
    FROM tenant_printers
    WHERE tenant_id = p_tenant_id AND is_default_kitchen = true
    LIMIT 1;

    -- Fallback: same as receipt printer
    IF v_printer IS NULL THEN
        RETURN get_default_receipt_printer(p_tenant_id);
    END IF;

    RETURN v_printer;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Grant execute to authenticated
GRANT EXECUTE ON FUNCTION get_default_receipt_printer(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_default_kitchen_printer(UUID) TO authenticated;

-- 8. Sample insert (run after creating tenant)
-- INSERT INTO tenant_printers (tenant_id, name, connection, paper_width, charset, cut_after_print, is_default_receipt, is_default_kitchen)
-- VALUES ('<tenant-uuid>', 'VSC Bluetooth', 'bluetooth', 58, 'cp858', true, true, true);