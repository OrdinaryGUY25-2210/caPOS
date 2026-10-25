create or replace function public.create_menu_with_recipe(
  p_product_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_name text,
  p_category text,
  p_price numeric,
  p_stock_mode text,
  p_items jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_recipe_id uuid := gen_random_uuid();
begin
  -- 1. Tenant harus milik user yang login
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and tenant_id = p_tenant_id
  ) then
    raise exception 'Tenant tidak sesuai dengan akun yang login';
  end if;

  -- 2. Cabang harus milik tenant tersebut
  if not exists (
    select 1 from public.branches
    where id = p_branch_id and tenant_id = p_tenant_id
  ) then
    raise exception 'Cabang tidak valid untuk tenant ini';
  end if;

  -- 3. Simpan produk (idempotent)
  insert into public.products (
    id, tenant_id, name, price, category, is_available,
    cost_price, track_stock, stock_qty, low_stock_threshold, stock_mode
  )
  values (
    p_product_id, p_tenant_id, p_name, p_price, p_category, true,
    0, false, 0, 0, p_stock_mode
  )
  on conflict (id) do nothing;

  if not found then
    return p_product_id;
  end if;

  -- 4. Simpan resep dan bahannya
  insert into public.recipes (
    id, tenant_id, product_id, name, version, is_active, yield_quantity, created_by
  )
  values (
    v_recipe_id, p_tenant_id, p_product_id, p_name, 1, true, 1, auth.uid()
  );

  insert into public.recipe_items (recipe_id, ingredient_id, quantity, unit)
  select v_recipe_id,
         (x->>'ingredient_id')::uuid,
         (x->>'quantity')::numeric,
         x->>'unit'
  from jsonb_array_elements(p_items) as x;

  -- 5. Hitung HPP dari harga bahan di cabang ini
  update public.products
  set cost_price = (
    select coalesce(sum(ri.quantity * bis.cost_price), 0)
    from public.recipe_items ri
    join public.branch_ingredients_stock bis
      on bis.ingredient_id = ri.ingredient_id
     and bis.branch_id = p_branch_id
    where ri.recipe_id = v_recipe_id
  )
  where id = p_product_id;

  return p_product_id;
end;
$$;
