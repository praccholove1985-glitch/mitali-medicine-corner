-- Green dashboard overview: daily totals are calculated by PostgreSQL and masked by permission.
-- The date range is limited to 31 calendar days and uses the pharmacy branch timezone.
create or replace function public.dashboard_overview(
  p_branch uuid,
  p_from date,
  p_to date
)
returns table (
  day date,
  sales_total numeric,
  sales_count bigint,
  gross_profit numeric,
  purchase_total numeric,
  purchase_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_timezone text;
  v_sales_all boolean;
  v_can_sales boolean;
  v_can_profit boolean;
  v_can_purchase_count boolean;
  v_can_purchase_total boolean;
begin
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 30 then
    raise exception 'date range must be between 1 and 31 days' using errcode = '22023';
  end if;

  v_sales_all := public.has_permission(p_branch, 'sale.view_all')
    or public.has_permission(p_branch, 'report.view');
  v_can_sales := v_sales_all
    or public.has_permission(p_branch, 'sale.create')
    or public.has_permission(p_branch, 'report.view_own');
  v_can_profit := v_can_sales and (
    public.has_permission(p_branch, 'finance.view_profit')
    or public.has_permission(p_branch, 'report.view')
    or public.has_permission(p_branch, 'report.view_own')
  );
  v_can_purchase_count := public.has_permission(p_branch, 'purchase.view')
    or public.has_permission(p_branch, 'report.view');
  v_can_purchase_total := public.has_permission(p_branch, 'report.view')
    or (
      public.has_permission(p_branch, 'purchase.view')
      and public.has_permission(p_branch, 'purchase.view_cost')
    );

  if not (v_can_sales or v_can_purchase_count) then
    raise exception 'permission denied: dashboard overview' using errcode = '42501';
  end if;

  select b.timezone into v_timezone
    from public.branches b
   where b.id = p_branch and b.is_active;
  if v_timezone is null then
    raise exception 'branch not found' using errcode = '42501';
  end if;

  return query
  with days as (
    select g.d::date as report_day
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g(d)
  ),
  sales_daily as (
    select (s.sold_at at time zone v_timezone)::date as report_day,
           sum(s.grand_total) as total,
           count(*)::bigint as sale_count,
           sum(s.profit_total) as profit
      from public.sales s
     where v_can_sales
       and s.branch_id = p_branch
       and (v_sales_all or s.created_by = auth.uid())
       and (s.sold_at at time zone v_timezone)::date between p_from and p_to
     group by (s.sold_at at time zone v_timezone)::date
  ),
  purchases_daily as (
    select (pu.created_at at time zone v_timezone)::date as report_day,
           sum(pu.grand_total) as total,
           count(*)::bigint as purchase_count
      from public.purchases pu
     where v_can_purchase_count
       and pu.branch_id = p_branch
       and (pu.created_at at time zone v_timezone)::date between p_from and p_to
     group by (pu.created_at at time zone v_timezone)::date
  )
  select d.report_day,
         case when v_can_sales then coalesce(s.total, 0) end,
         case when v_can_sales then coalesce(s.sale_count, 0) end,
         case when v_can_profit then coalesce(s.profit, 0) end,
         case when v_can_purchase_total then coalesce(p.total, 0) end,
         case when v_can_purchase_count then coalesce(p.purchase_count, 0) end
    from days d
    left join sales_daily s on s.report_day = d.report_day
    left join purchases_daily p on p.report_day = d.report_day
   order by d.report_day;
end
$$;

revoke all on function public.dashboard_overview(uuid, date, date) from public;
revoke all on function public.dashboard_overview(uuid, date, date) from anon;
grant execute on function public.dashboard_overview(uuid, date, date) to authenticated;
