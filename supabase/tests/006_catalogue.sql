-- Catalogue: companies, categories, medicines, price rules, cost privacy, search.
begin;

-- ---- permissions -------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier
select t.throws('select public.save_company(null, ''X Pharma'')', '42501', 'cashier cannot create a company');
select t.throws('select public.save_medicine(null, ''{"name":"X"}''::jsonb)', '42501', 'cashier cannot create a medicine');
select t.throws('insert into public.medicines (name) values (''X'')', '42501', 'no direct insert into medicines');
select t.throws('update public.medicines set name = ''X''', '42501', 'no direct update of medicines');
select t.throws('insert into public.companies (name) values (''X'')', '42501', 'no direct insert into companies');
select t.owner();

select t.anon();
select t.throws('select public.save_company(null, ''X'')', '42501', 'anon cannot call save_company');
select t.throws('select * from public.search_medicines(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'anon cannot search');
select t.owner();

select t.login('c0000000-0000-0000-0000-000000000001'); -- no membership
select t.throws('select public.save_company(null, ''X'')', '42501', 'a user with no membership cannot create a company');
select t.ok(t.count('select 1 from public.medicines') = 0, 'a user with no membership sees no medicines');
select t.owner();

-- ---- catalogue writes (pharmacist: medicine.edit, no price.edit) ---------------
select t.login('a3000000-0000-0000-0000-000000000001');
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

insert into ids values ('company', public.save_company(null, '  Square Pharmaceuticals  '));
insert into ids values ('category', public.save_category(null, 'Analgesics'));
insert into ids values ('sub', public.save_subcategory(null, (select v from ids where k = 'category'), 'Paracetamol'));
insert into ids values ('other_category', public.save_category(null, 'Antibiotics'));
select t.ok((select name from public.companies where id = (select v from ids where k = 'company')) = 'Square Pharmaceuticals',
  'company name is trimmed');
select t.throws('select public.save_company(null, ''square pharmaceuticals'')', '23505', 'company names are unique ignoring case');
select t.throws('select public.save_company(null, ''   '')', '23514', 'blank company name rejected');
select t.throws('select public.save_company(''00000000-0000-0000-0000-00000000dead'', ''Nope'')', 'P0002', 'updating a missing company fails');

-- Create without prices works for a pharmacist.
insert into ids values ('napa', public.save_medicine(null, jsonb_build_object(
  'name', 'Napa', 'generic_name', 'Paracetamol', 'brand_name', 'Napa', 'strength', '500mg',
  'dosage_form', 'Tablet', 'barcode', '8901234567890', 'sku', 'NAPA-500',
  'company_id', (select v from ids where k = 'company'),
  'category_id', (select v from ids where k = 'category'),
  'subcategory_id', (select v from ids where k = 'sub'),
  'mrp', '2.00', 'reorder_level', 50, 'pack_size', 10)));
select t.ok((select default_sale_price is null from public.medicines where id = (select v from ids where k = 'napa')),
  'a medicine created without prices has no price (not 0)');

select t.throws('select public.save_medicine(null, jsonb_build_object(''name'', ''Priced'', ''default_sale_price'', ''1.50''))',
  'PH033', 'pharmacist cannot set a sale price');
select t.throws('select public.save_medicine(null, jsonb_build_object(''name'', ''Priced'', ''default_purchase_price'', ''1.10''))',
  'PH033', 'pharmacist cannot set a purchase price');
select t.throws('select public.save_medicine(null, ''{"name":"X","colour":"red"}''::jsonb)', '22023', 'unknown fields are rejected');
select t.throws('select public.save_medicine(null, ''{"generic_name":"X"}''::jsonb)', '22023', 'name is required on create');
select t.throws('select public.save_medicine(null, ''{"name":"X","pack_size":"abc"}''::jsonb)', '22P02', 'non-numeric pack size rejected');
select t.throws('select public.save_medicine(null, ''{"name":"X","pack_size":0}''::jsonb)', '23514', 'zero pack size rejected');
select t.throws('select public.save_medicine(null, ''{"name":"X","mrp":"-1"}''::jsonb)', '23514', 'negative MRP rejected');
select t.throws('select public.save_medicine(null, ''{"name":"X","tax_rate":150}''::jsonb)', '23514', 'tax rate over 100 rejected');
select t.throws('select public.save_medicine(null, jsonb_build_object(''name'', ''Dup'', ''barcode'', ''8901234567890''))',
  '23505', 'a duplicate barcode is rejected');
select t.throws('select public.save_medicine(null, jsonb_build_object(''name'', ''Dup'', ''sku'', ''napa-500''))',
  '23505', 'a duplicate SKU is rejected ignoring case');
select t.throws(format('select public.save_medicine(null, jsonb_build_object(''name'', ''Mismatch'', ''category_id'', %L, ''subcategory_id'', %L))',
  (select v from ids where k = 'other_category'), (select v from ids where k = 'sub')),
  'PH034', 'a subcategory from another category is rejected');
select t.throws(format('select public.save_medicine(null, jsonb_build_object(''name'', ''NoCat'', ''subcategory_id'', %L))',
  (select v from ids where k = 'sub')),
  'PH034', 'a subcategory without a category is rejected');
select t.owner();

-- ---- price rules (admin: price.edit) -------------------------------------------
select t.login('a1000000-0000-0000-0000-000000000001');
select public.save_medicine((select v from ids where k = 'napa'),
  jsonb_build_object('default_purchase_price', '1.1250', 'default_sale_price', '1.50'));
select t.ok((select default_sale_price = 1.50 from public.medicines where id = (select v from ids where k = 'napa')),
  'admin can set the sale price');
select t.throws(format('select public.save_medicine(%L, ''{"default_sale_price":"2.50"}''::jsonb)', (select v from ids where k = 'napa')),
  'PH031', 'sale price above MRP is rejected');
select t.throws(format('select public.save_medicine(%L, ''{"mrp":"1.00"}''::jsonb)', (select v from ids where k = 'napa')),
  'PH031', 'lowering MRP below the sale price is rejected');
select t.ok(public.medicine_default_cost((select v from ids where k = 'napa')) = 1.1250, 'admin can read the default cost with four decimals');
select t.owner();

-- A pharmacist can edit other fields but not touch prices.
select t.login('a3000000-0000-0000-0000-000000000001');
select public.save_medicine((select v from ids where k = 'napa'), '{"strength":"650mg"}'::jsonb);
select t.ok((select strength from public.medicines where id = (select v from ids where k = 'napa')) = '650mg', 'pharmacist can edit non-price fields');
select t.ok((select default_sale_price = 1.50 from public.medicines where id = (select v from ids where k = 'napa')), 'editing other fields leaves prices alone');
select t.throws(format('select public.save_medicine(%L, ''{"default_sale_price":"1.20"}''::jsonb)', (select v from ids where k = 'napa')),
  'PH033', 'pharmacist cannot change an existing sale price');
-- Sending the unchanged price is not a change.
select public.save_medicine((select v from ids where k = 'napa'), '{"default_sale_price":"1.50"}'::jsonb);
select t.ok(true, 'resending an unchanged price needs no price.edit');
select t.owner();

-- ---- cost privacy ----------------------------------------------------------------
select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier
select t.ok(t.count('select name, default_sale_price, mrp from public.medicines') = 1, 'cashier can read medicines without cost columns');
select t.throws('select default_purchase_price from public.medicines', '42501', 'cashier cannot select the cost column');
select t.throws('select * from public.medicines', '42501', 'select * is refused because it includes cost');
select t.throws(format('select public.medicine_default_cost(%L)', (select v from ids where k = 'napa')), '42501', 'cashier cannot call medicine_default_cost');
select t.owner();
select t.login('a3000000-0000-0000-0000-000000000001'); -- pharmacist: no purchase.view_cost
select t.throws(format('select public.medicine_default_cost(%L)', (select v from ids where k = 'napa')), '42501', 'pharmacist cannot read cost');
select t.owner();

-- ---- audit ------------------------------------------------------------------------
select t.ok((select count(*) = 1 from public.audit_log
              where action = 'medicines.update'
                and entity_id = (select v::text from ids where k = 'napa')
                and old_values ->> 'default_sale_price' is null
                and new_values ->> 'default_sale_price' = '1.5000'),
  'setting a price is audited with old (unset) and new values');
select t.ok((select count(*) >= 1 from public.audit_log
              where action = 'companies.insert' and new_values ->> 'name' = 'Square Pharmaceuticals'),
  'creating a company is audited');

-- ---- search ------------------------------------------------------------------------
-- More medicines for ranking and escaping.
select public.save_medicine(null, '{"name":"Napa Extra","generic_name":"Paracetamol + Caffeine","strength":"500mg+65mg"}'::jsonb)
  from (select t.login('a3000000-0000-0000-0000-000000000001')) x;
select public.save_medicine(null, '{"name":"Zimax","generic_name":"Azithromycin","sku":"ZIM-500"}'::jsonb);
select public.save_medicine(null, '{"name":"100% Pure Honey","generic_name":"Honey"}'::jsonb);
select public.save_medicine(null, '{"name":"Retired Syrup","is_active":false}'::jsonb);
select t.owner();

select t.login('a4000000-0000-0000-0000-000000000001'); -- cashier: medicine.view + stock.view
select t.ok((select count(*) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', '')) = 4,
  'empty search lists active medicines only (inactive hidden)');
select t.ok((select count(*) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', '', 25, 0, true)) = 5,
  'include_inactive shows retired medicines');
select t.ok((select name from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', 'napa') limit 1) = 'Napa',
  'name prefix match ranks first');
select t.ok((select count(*) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', 'napa')) = 2,
  'search finds both Napa products');
select t.ok((select count(*) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', 'paracetamol')) = 2,
  'search matches the generic name');
select t.ok((select count(*) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', 'square pharma')) = 1,
  'search matches the company name');
select t.ok((select name from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', '8901234567890')) = 'Napa',
  'search by exact barcode');
select t.ok((select name from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', 'zim-500')) = 'Zimax',
  'search by SKU ignores case');
select t.ok((select count(*) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', '%')) = 1,
  'a percent sign is searched literally, not as a wildcard');
select t.ok((select count(*) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', '_')) = 0,
  'an underscore is searched literally');
select t.ok((select count(*) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', 'x'' or 1=1 --')) = 0,
  'SQL in the query is just text');
select t.ok((select max(total_count) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', '', 2, 0)) = 4
        and (select count(*) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', '', 2, 0)) = 2
        and (select count(*) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', '', 2, 2)) = 2,
  'paging returns the right slice and the total');
select t.ok((select count(*) from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', '', 100000, 0)) = 4,
  'limit is capped at 100');
select t.throws('select * from public.search_medicines(''bbbbbbbb-0000-0000-0000-000000000001'')', '42501', 'cashier A cannot search through Branch B');
select t.owner();

select t.login('b1000000-0000-0000-0000-000000000001'); -- admin B
select t.throws('select * from public.search_medicines(''aaaaaaaa-0000-0000-0000-000000000001'')', '42501', 'admin B cannot search through Branch A');
select t.ok((select count(*) from public.search_medicines('bbbbbbbb-0000-0000-0000-000000000001', 'napa')) = 2,
  'the catalogue is shared across branches');
select t.owner();

-- Without stock.view the stock column is blank, not zero.
select t.login('a5000000-0000-0000-0000-000000000001'); -- staff has stock.view
select t.ok((select stock_on_hand is not null from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', 'zimax')), 'staff sees stock (has stock.view)');
select t.owner();
insert into public.user_permission_overrides (user_id, branch_id, permission, granted)
values ('a5000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'stock.view', false);
select t.login('a5000000-0000-0000-0000-000000000001');
select t.ok((select stock_on_hand is null from public.search_medicines('aaaaaaaa-0000-0000-0000-000000000001', 'zimax')), 'without stock.view the stock figure is null, not 0');
select t.owner();

rollback;
