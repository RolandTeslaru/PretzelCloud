-- Addresses asking to hear when cloud hosting opens. Only portal_service reads or writes.

create table waitlist (
    email             text not null,
    created_at        timestamp with time zone default now() not null,
    -- When the thank-you email was accepted for sending, not when it arrived.
    thank_you_sent_at timestamp with time zone,

    constraint waitlist_pkey primary key (email)
);
