import converter


def test_file_names_keep_the_stem_and_get_md():
    assert converter.output_name_for_file("laporan.pdf") == "laporan.md"
    assert converter.output_name_for_file("Q3 report.final.docx") == "Q3 report.final.md"


def test_file_names_are_sanitized():
    assert converter.output_name_for_file('bad:name?.pdf') == "bad-name.md"
    assert converter.output_name_for_file(".hidden") == "hidden.md"
    assert converter.output_name_for_file("") == "document.md"


def test_url_names_come_from_host_and_path():
    assert converter.output_name_for_url("https://www.example.com/blog/post.html") == "example.com-blog-post.md"
    assert converter.output_name_for_url("https://example.com/") == "example.com.md"


def test_youtube_names_keep_the_video_id():
    assert converter.output_name_for_url("https://www.youtube.com/watch?v=abc_123-x") == "youtube.com-watch-abc_123-x.md"


def test_engine_version_is_known():
    assert converter.engine_version() != "unknown"


def test_stock_engine_converts_html():
    markdown = converter.convert_bytes(b"<h1>Title</h1><p>Body text</p>", "page.html", "text/html")
    assert "# Title" in markdown
    assert "Body text" in markdown


def test_stock_engine_converts_csv_to_a_table():
    markdown = converter.convert_bytes(b"name,qty\nbolt,12\n", "parts.csv")
    assert "| name | qty |" in markdown
    assert "| bolt | 12 |" in markdown
