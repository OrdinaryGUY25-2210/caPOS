'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getServerProfile } from '@/lib/getServerProfile';

// =========================================================
// SUPPLIER MANAGEMENT — CRUD Pemasok
// =========================================================

export async function createSupplier(formData: {
  supplier_code: string;
  company_name: string;
  contact_person?: string;
  phone_number?: string;
  whatsapp_number?: string;
  email?: string;
  address?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  payment_terms?: string;
  categories?: string[];
  bank_account?: string;
  bank_name?: string;
  account_holder_name?: string;
  notes?: string;
}) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    const { data, error } = await supabase
      .from('suppliers')
      .insert({
        tenant_id: profile.tenant_id,
        ...formData,
      })
      .select('id')
      .single();

    if (error) throw error;

    revalidatePath('/dashboard/purchasing/suppliers');
    return { data, success: true };
  } catch (error) {
    console.error('Error creating supplier:', error);
    return { error: String(error) };
  }
}

export async function updateSupplier(
  supplierId: string,
  updates: Partial<typeof createSupplier extends (a: infer T) => any ? T : never>
) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    const { data, error } = await supabase
      .from('suppliers')
      .update(updates)
      .eq('id', supplierId)
      .eq('tenant_id', profile.tenant_id)
      .select()
      .single();

    if (error) throw error;

    revalidatePath('/dashboard/purchasing/suppliers');
    return { data, success: true };
  } catch (error) {
    console.error('Error updating supplier:', error);
    return { error: String(error) };
  }
}

export async function getSuppliers() {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_active', true)
      .order('company_name');

    if (error) throw error;

    return { data };
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    return { error: String(error) };
  }
}

// =========================================================
// PURCHASE ORDER MANAGEMENT — PO & Goods Receipt
// =========================================================

export async function createPurchaseOrder(formData: {
  supplier_id: string;
  branch_id?: string;
  expected_delivery_date?: string;
  notes?: string;
  items: Array<{
    product_id: string;
    qty_ordered: number;
    unit_price: number;
  }>;
}) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    // Generate PO Number
    const { data: lastPO } = await supabase
      .from('purchase_orders')
      .select('po_number')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(1);

    let nextNumber = 1;
    if (lastPO && lastPO.length > 0) {
      const lastNum = parseInt(lastPO[0].po_number.split('-').pop() || '0');
      nextNumber = lastNum + 1;
    }

    const po_number = `PO-${new Date().getFullYear()}-${String(nextNumber).padStart(3, '0')}`;

    // Calculate totals
    let subtotal_amount = 0;
    formData.items.forEach((item) => {
      subtotal_amount += item.qty_ordered * item.unit_price;
    });

    const { data: poData, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        tenant_id: profile.tenant_id,
        po_number,
        supplier_id: formData.supplier_id,
        branch_id: formData.branch_id,
        expected_delivery_date: formData.expected_delivery_date,
        notes: formData.notes,
        subtotal_amount,
        total_amount: subtotal_amount,
        status: 'DRAFT',
        created_by: profile.id,
      })
      .select('id')
      .single();

    if (poError) throw poError;

    // Insert PO items
    const items = formData.items.map((item) => ({
      po_id: poData.id,
      product_id: item.product_id,
      qty_ordered: item.qty_ordered,
      unit_price: item.unit_price,
      subtotal: item.qty_ordered * item.unit_price,
    }));

    const { error: itemsError } = await supabase
      .from('po_items')
      .insert(items);

    if (itemsError) throw itemsError;

    revalidatePath('/dashboard/purchasing/purchase-orders');
    return { data: { id: poData.id, po_number }, success: true };
  } catch (error) {
    console.error('Error creating PO:', error);
    return { error: String(error) };
  }
}

export async function createGoodsReceipt(formData: {
  po_id: string;
  items: Array<{
    po_item_id: string;
    product_id: string;
    product_name: string;
    unit: string;
    qty_received: number;
    unit_price: number;
  }>;
  notes?: string;
}) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    // Get PO info
    const { data: poData, error: poError } = await supabase
      .from('purchase_orders')
      .select('*, branch_id')
      .eq('id', formData.po_id)
      .single();

    if (poError || !poData) throw new Error('PO tidak ditemukan');

    // Generate GRN Number
    const { data: lastGRN } = await supabase
      .from('goods_receipts')
      .select('grn_number')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(1);

    let nextNumber = 1;
    if (lastGRN && lastGRN.length > 0) {
      const lastNum = parseInt(lastGRN[0].grn_number.split('-').pop() || '0');
      nextNumber = lastNum + 1;
    }

    const grn_number = `GRN-${new Date().getFullYear()}-${String(nextNumber).padStart(3, '0')}`;

    // Create GRN
    const { data: grnData, error: grnError } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: profile.tenant_id,
        branch_id: poData.branch_id,
        po_id: formData.po_id,
        grn_number,
        supplier_id: poData.supplier_id,
        notes: formData.notes,
        received_by: profile.id,
      })
      .select('id')
      .single();

    if (grnError) throw grnError;

    // Insert GRN items
    const grnItems = formData.items.map((item) => ({
      grn_id: grnData.id,
      po_item_id: item.po_item_id,
      product_id: item.product_id,
      product_name: item.product_name,
      unit: item.unit,
      qty_received: item.qty_received,
      unit_price: item.unit_price,
      actual_cost: item.qty_received * item.unit_price,
    }));

    const { error: itemsError } = await supabase
      .from('grn_items')
      .insert(grnItems);

    if (itemsError) throw itemsError;

    // Proses GRN (update stok + HPP)
    const { error: processError } = await supabase.rpc('process_goods_receipt', {
      p_grn_id: grnData.id,
    });

    if (processError) throw processError;

    revalidatePath('/dashboard/purchasing/goods-receipt');
    revalidatePath('/dashboard/stock');
    return { data: { id: grnData.id, grn_number }, success: true };
  } catch (error) {
    console.error('Error creating GRN:', error);
    return { error: String(error) };
  }
}

// =========================================================
// CUSTOMER MANAGEMENT — CRM & Loyalty Integration
// =========================================================

export async function createCustomer(formData: {
  customer_code: string;
  customer_name: string;
  phone_number?: string;
  whatsapp_number?: string;
  email?: string;
  address?: string;
  city?: string;
  birthday?: string;
  branch_id?: string;
  notes?: string;
}) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    const { data, error } = await supabase
      .from('customers')
      .insert({
        tenant_id: profile.tenant_id,
        ...formData,
      })
      .select('id, customer_code')
      .single();

    if (error) throw error;

    revalidatePath('/dashboard/crm/customers');
    return { data, success: true };
  } catch (error) {
    console.error('Error creating customer:', error);
    return { error: String(error) };
  }
}

export async function searchCustomers(query: string) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    const { data, error } = await supabase
      .from('customers')
      .select('id, customer_code, customer_name, phone_number, lifetime_spend')
      .eq('tenant_id', profile.tenant_id)
      .or(
        `customer_name.ilike.%${query}%,customer_code.ilike.%${query}%,phone_number.ilike.%${query}%`
      )
      .limit(10);

    if (error) throw error;

    return { data };
  } catch (error) {
    console.error('Error searching customers:', error);
    return { error: String(error) };
  }
}

export async function getCustomerProfile(customerId: string) {
  try {
    const supabase = await createClient();

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (customerError) throw customerError;

    // Get loyalty points balance
    const { data: pointsData } = await supabase
      .from('loyalty_points_log')
      .select('points_amount, transaction_type')
      .eq('customer_id', customerId);

    let loyaltyBalance = 0;
    pointsData?.forEach((log) => {
      if (log.transaction_type === 'EARN' || log.transaction_type === 'ADJUST') {
        loyaltyBalance += log.points_amount;
      } else {
        loyaltyBalance -= log.points_amount;
      }
    });

    // Get recent transactions
    const { data: transactions } = await supabase
      .from('transactions')
      .select('id, invoice_number, total_amount, created_at')
      .eq('member_id', customerId)
      .order('created_at', { ascending: false })
      .limit(5);

    return {
      data: {
        ...customer,
        loyaltyBalance: Math.max(0, loyaltyBalance),
        recentTransactions: transactions || [],
      },
    };
  } catch (error) {
    console.error('Error fetching customer profile:', error);
    return { error: String(error) };
  }
}

// =========================================================
// LOYALTY SYSTEM — Points Earn & Redeem
// =========================================================

export async function recordLoyaltyEarn(
  transactionId: string,
  customerId: string,
  transactionAmount: number
) {
  try {
    const supabase = await createClient();

    // Get loyalty config
    const { profile } = await getServerProfile();
    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    const { data: config } = await supabase
      .from('loyalty_config')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .single();

    if (!config || !config.is_enabled) {
      return { data: { points: 0 }, success: true };
    }

    // Call function to calculate & record points
    const { data, error } = await supabase.rpc('calculate_loyalty_points', {
      p_tenant_id: profile.tenant_id,
      p_transaction_amount: transactionAmount,
    });

    if (error) throw error;

    const points = data || 0;

    if (points > 0) {
      const earnError = await supabase.rpc('earn_loyalty_points', {
        p_transaction_id: transactionId,
        p_customer_id: customerId,
        p_points: points,
      });

      if (earnError) throw earnError;
    }

    return { data: { points }, success: true };
  } catch (error) {
    console.error('Error recording loyalty earn:', error);
    return { error: String(error) };
  }
}

export async function redeemLoyaltyPoints(
  customerId: string,
  pointsToRedeem: number,
  discountAmount: number
) {
  try {
    const supabase = await createClient();

    const { error } = await supabase.rpc('redeem_loyalty_points', {
      p_customer_id: customerId,
      p_points_to_redeem: pointsToRedeem,
      p_discount_amount: discountAmount,
    });

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error('Error redeeming loyalty points:', error);
    return { error: String(error) };
  }
}

// =========================================================
// PROMOTION & VOUCHER MANAGEMENT
// =========================================================

export async function createPromotion(formData: {
  promo_name: string;
  promo_type: 'PERCENTAGE' | 'NOMINAL' | 'BOGO' | 'BUNDLE';
  description?: string;
  promo_code?: string;
  branch_id?: string;
  start_date: string;
  end_date?: string;
  rules?: Array<{
    rule_type: string;
    rule_value: string;
  }>;
}) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    // Create promotion
    const { data: promoData, error: promoError } = await supabase
      .from('promotions')
      .insert({
        tenant_id: profile.tenant_id,
        branch_id: formData.branch_id,
        promo_name: formData.promo_name,
        promo_type: formData.promo_type,
        description: formData.description,
        promo_code: formData.promo_code,
        start_date: formData.start_date,
        end_date: formData.end_date,
      })
      .select('id')
      .single();

    if (promoError) throw promoError;

    // Insert rules if provided
    if (formData.rules && formData.rules.length > 0) {
      const rules = formData.rules.map((rule) => ({
        promotion_id: promoData.id,
        ...rule,
      }));

      const { error: rulesError } = await supabase
        .from('promotion_rules')
        .insert(rules);

      if (rulesError) throw rulesError;
    }

    revalidatePath('/dashboard/promotions');
    return { data: { id: promoData.id }, success: true };
  } catch (error) {
    console.error('Error creating promotion:', error);
    return { error: String(error) };
  }
}

export async function createVoucher(formData: {
  promotion_id: string;
  voucher_code: string;
  voucher_name?: string;
  discount_type: 'PERCENTAGE' | 'NOMINAL';
  discount_value: number;
  max_discount_amount?: number;
  min_purchase_amount?: number;
  usage_limit?: number;
  expiry_date?: string;
  branch_id?: string;
}) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    const { data, error } = await supabase
      .from('vouchers')
      .insert({
        tenant_id: profile.tenant_id,
        ...formData,
      })
      .select('id, voucher_code')
      .single();

    if (error) throw error;

    revalidatePath('/dashboard/promotions/vouchers');
    return { data, success: true };
  } catch (error) {
    console.error('Error creating voucher:', error);
    return { error: String(error) };
  }
}

export async function validateAndApplyVoucher(
  voucherCode: string,
  transactionAmount: number
) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    const { data: voucher, error: voucherError } = await supabase
      .from('vouchers')
      .select('*, promotions(*)')
      .eq('tenant_id', profile.tenant_id)
      .eq('voucher_code', voucherCode)
      .eq('is_active', true)
      .single();

    if (voucherError || !voucher) {
      return { error: 'Kode voucher tidak valid' };
    }

    // Check expiry
    if (voucher.expiry_date && new Date(voucher.expiry_date) < new Date()) {
      return { error: 'Voucher sudah kadaluarsa' };
    }

    // Check usage limit
    if (voucher.usage_limit && voucher.usage_count >= voucher.usage_limit) {
      return { error: 'Voucher sudah mencapai batas penggunaan' };
    }

    // Check minimum purchase
    if (transactionAmount < voucher.min_purchase_amount) {
      return {
        error: `Pembelian minimal Rp${voucher.min_purchase_amount} diperlukan`,
      };
    }

    // Calculate discount
    let discount = 0;
    if (voucher.discount_type === 'PERCENTAGE') {
      discount = Math.round((transactionAmount * voucher.discount_value) / 100);
      if (voucher.max_discount_amount && discount > voucher.max_discount_amount) {
        discount = voucher.max_discount_amount;
      }
    } else {
      discount = Math.min(voucher.discount_value, transactionAmount);
    }

    return {
      data: {
        voucher_id: voucher.id,
        discount,
        finalAmount: Math.max(0, transactionAmount - discount),
      },
      success: true,
    };
  } catch (error) {
    console.error('Error validating voucher:', error);
    return { error: String(error) };
  }
}

// =========================================================
// ANALYTICS & REPORTING
// =========================================================

export async function getProductProfitability(branchId?: string, limit: number = 20) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    let query = supabase
      .from('product_profitability')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .order('gross_profit', { ascending: false })
      .limit(limit);

    if (branchId) {
      query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { data };
  } catch (error) {
    console.error('Error fetching profitability:', error);
    return { error: String(error) };
  }
}

export async function getPeakHoursAnalytics(branchId?: string) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    let query = supabase
      .from('peak_hours_analytics')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .order('hour_of_day');

    if (branchId) {
      query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { data };
  } catch (error) {
    console.error('Error fetching peak hours:', error);
    return { error: String(error) };
  }
}

export async function getWasteLossReport(branchId?: string, days: number = 30) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query = supabase
      .from('waste_logs')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });

    if (branchId) {
      query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Calculate summary
    const totalLoss =
      data?.reduce((sum, item) => sum + (item.total_loss_amount || 0), 0) || 0;
    const byType: Record<string, number> = {};

    data?.forEach((item) => {
      byType[item.waste_type] = (byType[item.waste_type] || 0) + item.total_loss_amount;
    });

    return { data: { items: data, summary: { totalLoss, byType } } };
  } catch (error) {
    console.error('Error fetching waste loss:', error);
    return { error: String(error) };
  }
}

export async function recordWasteLoss(formData: {
  product_id: string;
  product_name: string;
  waste_type: 'EXPIRED' | 'DAMAGED' | 'SPOILED' | 'LOSS';
  qty_wasted: number;
  cost_price: number;
  notes?: string;
  branch_id?: string;
}) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();

    if (!profile?.tenant_id) {
      return { error: 'Tenant tidak ditemukan' };
    }

    const { data, error } = await supabase
      .from('waste_logs')
      .insert({
        tenant_id: profile.tenant_id,
        ...formData,
        total_loss_amount: formData.qty_wasted * formData.cost_price,
        recorded_by: profile.id,
      })
      .select('id')
      .single();

    if (error) throw error;

    revalidatePath('/dashboard/analytics/waste-loss');
    return { data, success: true };
  } catch (error) {
    console.error('Error recording waste loss:', error);
    return { error: String(error) };
  }
}

// =========================================================
// TAMBAHAN STUDIO D13 (merge notes) — Phase 3 asli hanya menyediakan
// searchCustomers (butuh query) & getCustomerProfile (butuh id), belum
// ada fungsi LIST polos untuk menampilkan seluruh pelanggan/promosi/
// voucher di halaman dashboard. Dua fungsi di bawah melengkapi itu
// supaya /dashboard/crm/customers & /dashboard/promotions punya data
// untuk ditampilkan saat pertama dibuka (sebelum user mengetik apa pun
// di kotak pencarian).
// =========================================================

export async function getCustomers(limit: number = 100) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();
    if (!profile?.tenant_id) return { error: 'Tenant tidak ditemukan' };

    const { data, error } = await supabase
      .from('customers')
      .select('*, customer_tiers(tier_name)')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { data, success: true };
  } catch (error) {
    console.error('Error fetching customers:', error);
    return { error: String(error) };
  }
}

export async function getPromotions() {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();
    if (!profile?.tenant_id) return { error: 'Tenant tidak ditemukan' };

    const { data, error } = await supabase
      .from('promotions')
      .select('*, vouchers(*)')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { data, success: true };
  } catch (error) {
    console.error('Error fetching promotions:', error);
    return { error: String(error) };
  }
}

export async function toggleCustomerActive(customerId: string, isActive: boolean) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();
    if (!profile?.tenant_id) return { error: 'Tenant tidak ditemukan' };

    const { error } = await supabase
      .from('customers')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', customerId)
      .eq('tenant_id', profile.tenant_id);

    if (error) throw error;
    revalidatePath('/dashboard/crm/customers');
    return { success: true };
  } catch (error) {
    console.error('Error toggling customer:', error);
    return { error: String(error) };
  }
}

export async function togglePromotionActive(promotionId: string, isActive: boolean) {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();
    if (!profile?.tenant_id) return { error: 'Tenant tidak ditemukan' };

    const { error } = await supabase
      .from('promotions')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', promotionId)
      .eq('tenant_id', profile.tenant_id);

    if (error) throw error;
    revalidatePath('/dashboard/promotions');
    return { success: true };
  } catch (error) {
    console.error('Error toggling promotion:', error);
    return { error: String(error) };
  }
}
