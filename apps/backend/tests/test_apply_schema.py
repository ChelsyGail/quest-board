from database.apply_schema import SCHEMA_DIRECTORY
from database.apply_schema import split_statements


def test_semicolons_in_comments_do_not_split_statements():
    sql = "-- Saved items; quests too.\nCREATE TABLE a (id INT);\n\nCREATE TABLE b (id INT);\n"

    assert split_statements(sql) == ["CREATE TABLE a (id INT)", "CREATE TABLE b (id INT)"]


def test_every_schema_file_splits_into_sql_statements():
    for schema_file in sorted(SCHEMA_DIRECTORY.glob("*.sql")):
        for statement in split_statements(schema_file.read_text(encoding="utf-8")):
            assert statement.split()[0].upper() in {"CREATE", "ALTER"}, schema_file.name
