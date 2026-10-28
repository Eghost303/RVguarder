"""类型化事实：管理员身份与密钥载荷不能靠关键字子串判定。"""
from __future__ import annotations

from clawRVguarder.engine.semantic_models import local_semantic_match
from clawRVguarder.models import BehaviorEvent


def _event(action_type: str, params: dict, **extra) -> BehaviorEvent:
    return BehaviorEvent(
        event_id="e1", timestamp="2026-10-29T00:00:00Z", action_type=action_type,
        process_name="dsh", pid=None, user=None, raw_payload={"params": params}, **extra,
    )


def _fact(event: BehaviorEvent, name: str) -> bool:
    return bool(local_semantic_match(event).facts[name].value)


def test_url_containing_the_word_token_is_not_a_secret_payload() -> None:
    event = _event("network_egress", {"url": "https://example.test/download?token=1"})

    assert _fact(event, "network.secret_payload") is False
    assert _fact(event, "network.secret_mention") is True


def test_bearer_value_is_a_secret_payload() -> None:
    event = _event("network_egress", {
        "url": "https://example.test/upload",
        "headers": {"Authorization": "Bearer abcdefghijklmnop123456"},
    })

    assert _fact(event, "network.secret_payload") is True


def test_message_to_admin_recipient_is_admin_channel() -> None:
    event = _event("channel_send", {"to": "admin@company.local", "text": "hi"})

    assert _fact(event, "channel.admin") is True


def test_body_mentioning_admin_is_only_a_mention() -> None:
    """正文提到 admin 不能被当成向管理员发信。"""
    event = _event("channel_send", {"to": "team@company.local", "text": "please ask the admin group"})

    assert _fact(event, "channel.admin") is False
    assert _fact(event, "channel.admin_mention") is True
