"""The pure parts of the question router: language, unknown entities, and which words mean what."""

from stratum.ask import intent


def test_language_detection_covers_devanagari_and_romanised_hindi():
    assert intent.detect_language("2022-23 में SECL का कोयला उत्पादन कितना था?") == "hi"
    assert intent.detect_language("SECL ka 2022-23 mein utpadan kitna tha?") == "hi"
    assert intent.detect_language("What was the production of SECL in FY2023-24?") == "en"
    assert intent.detect_language("What is the main reason for the target?") == "en"


def test_a_name_the_master_data_does_not_know_is_not_answered_with_all_india_figures():
    assert intent._unknown_entity("What is the coal production of Mars Colony in 2024?") == "Mars Colony"
    assert intent._unknown_entity("What was the coal production of Central Coalfields Limited in FY 2023-24?") is None
    assert intent._unknown_entity("What was coal production in April 2024?") is None
    assert intent._unknown_entity("What was coal production in FY2023-24?") is None


def test_achievement_and_policy_words():
    assert intent.ACHIEVEMENT.search("Did SECL achieve its production target in 2023-24?")
    assert intent.ACHIEVEMENT.search("whether the production target was achieved")
    assert not intent.ACHIEVEMENT.search("What was SECL production in 2023-24?")
    assert intent.POLICY.search("What steps are taken to enhance coal production?")
    assert intent.EXPLAIN.search("Why did production increase?")
    assert intent.COMPARE.search("Compare MCL and NCL")
