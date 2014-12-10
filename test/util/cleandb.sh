echo 'drop keyspace if exists "local_restbase_T_tables";
drop keyspace if exists "local_restbase_T_domains";
drop keyspace if exists "local_test_wikipedia_en_T_pages_dataY_5U7x32eajwQ";
drop keyspace if exists "local_test_wikipedia_en_T_pages_html";
drop keyspace if exists "local_test_wikipedia_en_T_pages_rev";
drop keyspace if exists "local_test_wikipedia_en_T_pages_dataUweNiypIUmVNC";
drop keyspace if exists "local_test_wikipedia_en_T_pages_wikitext";' | cqlsh
