create unique index bookings_actor_journey_leg_idx on public.bookings
  (actor_id, (payload->'request'->>'journeyId'), ((payload->'request'->>'journeyLeg')::integer))
  where payload->'request'->>'journeyId' is not null;
