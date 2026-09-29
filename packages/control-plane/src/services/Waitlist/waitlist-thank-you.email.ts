// The email a new waitlist address receives.

const REPOSITORY_URL = 'https://github.com/RolandTeslaru/Pretzel-Graph';

export const WAITLIST_THANK_YOU = {
    subject: "You're on the PretzelCloud waitlist",

    text: [
        'Hi,',
        '',
        "Thanks for joining the PretzelCloud waitlist. We'll email you once, when cloud hosting opens.",
        '',
        "Can't wait? PretzelGraph is free to self-host today, with one Docker command:",
        REPOSITORY_URL,
        '',
        'The PretzelGraph team',
        '',
        "Didn't sign up? Reply to this email and we'll remove your address.",
    ].join('\n'),

    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#101828;max-width:520px">
<p>Hi,</p>
<p>Thanks for joining the PretzelCloud waitlist. We'll email you once, when cloud hosting opens.</p>
<p>Can't wait? PretzelGraph is free to self-host today, with one Docker command:<br><a href="${REPOSITORY_URL}" style="color:#ff6b00">${REPOSITORY_URL}</a></p>
<p>The PretzelCloud team</p>
<p style="font-size:13px;color:#6a7282">Didn't sign up? Reply to this email and we'll remove your address.</p>
</div>`,
};
