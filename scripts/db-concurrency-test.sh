#!/usr/bin/env bash
# Real concurrency checks for complete_sale, using separate database connections:
#   1. eight cashiers each try to sell 1 of the last 5 units at once: exactly 5 succeed,
#      3 are refused for stock, stock ends at exactly 0 and is never negative
#   2. invoice numbers of the successful sales are 1..5 with no gaps or duplicates
#   3. four connections submit the SAME client_request_id at once: exactly one sale
#   4. a sale waiting on a locked batch re-reads the stock after the first commits
#   5. six cashiers each try to take 40 against a 100 due: exactly 2 are accepted, the due
#      ends at 20 and never goes negative
#
#   scripts/db-concurrency-test.sh      (same DATABASE_ADMIN_URL convention as db-test.sh)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="mmc_conc_$$"

admin_psql() {
  if [[ -n "${DATABASE_ADMIN_URL:-}" ]]; then psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q "$@"
  else runuser -u postgres -- psql -d postgres -v ON_ERROR_STOP=1 -q "$@"; fi
}
db_psql() {
  if [[ -n "${DATABASE_ADMIN_URL:-}" ]]; then psql "${DATABASE_ADMIN_URL%/*}/$DB" -v ON_ERROR_STOP=1 -q "$@"
  else runuser -u postgres -- psql -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; fi
}
db_psql_loose() {  # keeps going after an error so a refused sale is reported, not fatal
  if [[ -n "${DATABASE_ADMIN_URL:-}" ]]; then psql "${DATABASE_ADMIN_URL%/*}/$DB" -q -t -A "$@"
  else runuser -u postgres -- psql -d "$DB" -q -t -A "$@"; fi
}

cleanup() { admin_psql -c "drop database if exists $DB" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
TMP="$(mktemp -d)"; chmod 755 "$TMP"
trap cleanup EXIT

fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }

admin_psql -c "create database $DB" >/dev/null
db_psql < "$ROOT/supabase/tests/stub/auth_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do db_psql --single-transaction < "$f" || fail "migration $(basename "$f")"; done

BR=aaaaaaaa-0000-0000-0000-000000000001
CASHIER=a4000000-0000-0000-0000-000000000001
MED=d1000000-0000-0000-0000-000000000001
BATCH=e1000000-0000-0000-0000-000000000001

db_psql <<SQL
begin;
insert into public.branches (id, name) values ('$BR', 'Branch A');
insert into auth.users (id, email, raw_user_meta_data) values ('$CASHIER', 'cashier@test', '{"full_name":"Cashier"}');
insert into public.branch_members (user_id, branch_id, role) values ('$CASHIER', '$BR', 'CASHIER');
insert into public.medicines (id, name) values ('$MED', 'Napa');
insert into public.medicine_batches (id, branch_id, medicine_id, batch_number, expiry_date, purchase_price, sale_price, quantity)
  values ('$BATCH', '$BR', '$MED', 'A', current_date + 100, 1.00, 2.00, 5);
insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type)
  values ('$BR', '$MED', '$BATCH', 5, 'OPENING_STOCK');
commit;
SQL

sale_sql() {  # $1 = request id, $2 = quantity, $3 = pre-commit sleep
  cat <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$CASHIER","role":"authenticated"}', true);
select 'OK:' || (public.complete_sale(jsonb_build_object(
  'branch_id', '$BR', 'client_request_id', '$1',
  'items', jsonb_build_array(jsonb_build_object('medicine_id', '$MED', 'quantity', $2)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'CASH', 'amount', ($2 * 2)::text)))) ->> 'invoice_no');
select pg_sleep($3);
commit;
SQL
}

# ---- 1 + 2: eight concurrent single-unit sales against 5 units -----------------------------
for i in 1 2 3 4 5 6 7 8; do
  sale_sql "00000000-0000-0000-0000-00000000000$i" 1 0.3 > "$TMP/s$i.sql"
  ( db_psql_loose < "$TMP/s$i.sql" > "$TMP/o$i.txt" 2> "$TMP/e$i.txt" ) &
done
wait

succeeded=$(cat "$TMP"/o*.txt | grep -c '^OK:' || true)
refused=$(cat "$TMP"/e*.txt | grep -c 'not enough sellable stock' || true)
[[ "$succeeded" == "5" ]] || fail "expected 5 successful sales, got $succeeded"
[[ "$refused" == "3" ]] || fail "expected 3 sales refused for stock, got $refused"
ok "8 concurrent sales of the last 5 units: 5 succeeded, 3 refused for stock"

qty=$(db_psql_loose -c "select quantity from public.medicine_batches where id = '$BATCH'")
[[ "$qty" == "0" ]] || fail "stock should end at exactly 0, got $qty"
ok "stock ended at exactly 0 (never negative)"

seqs=$(db_psql_loose -c "select string_agg(invoice_seq::text, ',' order by invoice_seq) from public.sales")
[[ "$seqs" == "1,2,3,4,5" ]] || fail "invoice numbers should be 1..5 without gaps, got $seqs"
ok "invoice numbers are 1..5 with no gaps or duplicates (refused sales used none)"

mv=$(db_psql_loose -c "select coalesce(sum(quantity_delta),0) from public.stock_movements where batch_id = '$BATCH'")
[[ "$mv" == "0" ]] || fail "movements should sum to 0 (5 in, 5 out), got $mv"
ok "stock movements add up to the batch quantity"

# ---- 3: the same request id from four connections ------------------------------------------------
db_psql <<SQL
begin;
insert into public.stock_movements (branch_id, medicine_id, batch_id, quantity_delta, movement_type, reason)
  values ('$BR', '$MED', '$BATCH', 10, 'CORRECTION', 'restock for test');
update public.medicine_batches set quantity = 10 where id = '$BATCH';
commit;
SQL
for i in 1 2 3 4; do
  sale_sql "99999999-0000-0000-0000-000000000001" 2 0.5 > "$TMP/r$i.sql"
  ( db_psql_loose < "$TMP/r$i.sql" > "$TMP/ro$i.txt" 2> "$TMP/re$i.txt" ) &
done
wait
same=$(db_psql_loose -c "select count(*) from public.sales where client_request_id = '99999999-0000-0000-0000-000000000001'")
[[ "$same" == "1" ]] || fail "the same request id made $same sales"
returned=$(cat "$TMP"/ro?.txt | grep -c '^OK:' || true)
[[ "$returned" == "4" ]] || fail "all four callers should receive the invoice, got $returned"
qty=$(db_psql_loose -c "select quantity from public.medicine_batches where id = '$BATCH'")
[[ "$qty" == "8" ]] || fail "stock should be 10 - 2 = 8 after one sale, got $qty"
ok "four simultaneous submits of one request id: one sale, stock moved once, everyone got the invoice"

# ---- 4: a waiting sale re-reads stock after the lock is released ---------------------------------
sale_sql "aaaaaaaa-1111-0000-0000-000000000001" 8 1.5 > "$TMP/w1.sql"
sale_sql "aaaaaaaa-1111-0000-0000-000000000002" 1 0 > "$TMP/w2.sql"
( db_psql_loose < "$TMP/w1.sql" > "$TMP/wo1.txt" 2> "$TMP/we1.txt" ) &
sleep 0.5
( db_psql_loose < "$TMP/w2.sql" > "$TMP/wo2.txt" 2> "$TMP/we2.txt" ) &
wait
grep -q '^OK:' "$TMP/wo1.txt" || fail "the first sale should have succeeded"
grep -q 'not enough sellable stock' "$TMP/we2.txt" || fail "the waiting sale should see the stock the first one took"
qty=$(db_psql_loose -c "select quantity from public.medicine_batches where id = '$BATCH'")
[[ "$qty" == "0" ]] || fail "stock should be 0, got $qty"
ok "a sale blocked behind a lock re-checked stock after the first committed and was refused"

# ---- 5: concurrent payments cannot overpay a due -------------------------------------------------
CUST=c1000000-0000-0000-0000-000000000001
db_psql <<SQL
begin;
insert into public.customers (id, branch_id, name) values ('$CUST', '$BR', 'Payer');
insert into public.customer_ledger_entries (branch_id, customer_id, entry_type, amount)
  values ('$BR', '$CUST', 'SALE_DUE', 100);
commit;
SQL
pay_sql() {
  cat <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$CASHIER","role":"authenticated"}', true);
select 'OK:' || (public.receive_customer_payment(jsonb_build_object(
  'branch_id', '$BR', 'customer_id', '$CUST', 'client_request_id', '$1',
  'method', 'CASH', 'amount', '40')) ->> 'balance_after');
select pg_sleep(0.3);
commit;
SQL
}
for i in 1 2 3 4 5 6; do
  pay_sql "bbbbbbbb-2222-0000-0000-00000000000$i" > "$TMP/p$i.sql"
  ( db_psql_loose < "$TMP/p$i.sql" > "$TMP/po$i.txt" 2> "$TMP/pe$i.txt" ) &
done
wait
accepted=$(cat "$TMP"/po?.txt | grep -c '^OK:' || true)
refused=$(cat "$TMP"/pe?.txt | grep -c 'payment exceeds what is due' || true)
[[ "$accepted" == "2" ]] || fail "expected 2 accepted payments, got $accepted"
[[ "$refused" == "4" ]] || fail "expected 4 refused payments, got $refused"
due=$(db_psql_loose -c "select sum(amount) from public.customer_ledger_entries where customer_id = '$CUST'")
[[ "$due" == "20.00" ]] || fail "the due should end at 20.00, got $due"
ok "six simultaneous 40 payments against a 100 due: 2 accepted, 4 refused, due ended at 20.00"

# Everything still reconciles.
db_psql_loose <<SQL > "$TMP/recon.txt"
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$CASHIER","role":"authenticated"}', true);
reset role;
select count(*) from public.medicine_batches b
 where b.quantity <> coalesce((select sum(quantity_delta) from public.stock_movements m where m.batch_id = b.id), 0);
commit;
SQL
drift=$(tail -1 "$TMP/recon.txt" | tr -d '[:space:]')
[[ "$drift" == "0" ]] || fail "$drift batches disagree with their movements"
ok "every batch still equals the sum of its movements"

echo "ALL CONCURRENCY TESTS PASSED"
