const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');

class Crawler {
  constructor(url) {
    this.startURL = url;
    // {category name: category object}
    this.categories = {};
    this.numCategories = 0;
    // % of categories for which crawler successfully discovers sub categories
    this.successFetchCategories = 0;
  }

  // args: url
  // out: returns html content
  async getPage(url) {
    if (url === undefined) {
      throw new Error('\nNo URL provided.\n');
    }
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    // max timeout doubled from default 30 secs for slow connections
    await page.goto(url,{timeout:60000}).catch((err) => {
      browser.close();
      throw new Error(err);
    });
    let html = await page.content();
    browser.close();
    return html;
  }

  // args: list of category names to omit
  // out: populates crawler.categories with category objects
  async fetchCategories(omitList) {
    // get html from url
    var isValidURL = true;
    const html = await this.getPage(this.startURL).catch((err) => {
      console.log('\nCould not fetch home page.\n');
      console.log(err+'\n');
      isValidURL = false;
    });
    if (!isValidURL) {
      console.log('\nFailed to fetch categories\n');
      return -1;
    }
    const $ = await cheerio.load(html);
    // parse for form object containing drop down with all categories
    const form = await $('form[name="site-search"]');
    // initialize variables needed to generate URI string
    const baseURL = this.startURL;
    const action = await form.attr('action');
    const category_fieldname = await encodeURIComponent(form.find('select').attr('name'));
    const searchname = await encodeURIComponent(form.find('input[type=text]').attr('name'));
    // temperary reference to crawler for access within .each loop
    const tempThis = this;
    // for each option/category in drop down create category object
    await form.find('select').find('option').each(function(i, element) {
      element = $(element);
      const category_field_val = encodeURIComponent(element.attr('value'));
      var name = element.text().trim();
      // do not want category if in omitList
      var i;
      for (i = 0; i < omitList.length; i++) {
        if (name == omitList[i]) {
          // return == continue in jQuery .each loop
          return;
        }
      }
      // hard code for proper naming of clothing categories
      if (name == 'Women' || name == 'Men' || name == 'Girls' || name == 'Boys') {
        name = 'Fashion-'+name;
      }
      // combine into URI
      const url = baseURL + action + '?' + category_fieldname + '=' + category_field_val + '&' + searchname + '=';
      // create Category object and push to crawler.categories
      const cat = new Category(name, url);
      tempThis.categories[name] = cat;
      tempThis.numCategories++;
    });
    console.log('\nCategories fetched successfully.\n');
  }

  // args: category name
  // out: populates category.subcategories
  async fetchSubCategories(category) {
    const cat = await this.categories[category];
    const baseURL = this.startURL;
    const catURL = await cat.getURL();
    const html = await this.getPage(catURL).catch((err) => {
      console.log('\nCould not fetch category page.\n');
      console.log(err+'\n');
      return -1;
    });
    const $ = await cheerio.load(html);
    // fetch target element within left nav bar containing li for every subcategory
    const targetElement = await $('div[id="leftNav"]').find('ul[class="a-unordered-list a-nostyle a-vertical s-ref-indent-one"]').find('div[aria-live="polite"]');
    if (targetElement === undefined) {
      console.log('\nCould not find list of subcategories on the '+category+' category page.\n');
      return -1;
    }
    targetElement.find('a').each(function(i,element) {
      element = $(element);
      const name = element.text().trim();
      var url = element.attr('href').trim();
      if (name === undefined || url === undefined) {
        console.log('\nIn category: '+category+', could not parse a tag number '+i+' for subcategory information.\n');
        return;
      }
      // make sure url has base url
      if (!(url.startsWith('https://') || url.startsWith('http://') || url.startsWith('www.'))) {
        url = baseURL + url;
      }
      const subCat = new SubCategory(name, category, url);
      cat.subCategories[name] = subCat;
      cat.numSubCategories++;
    });
    console.log('Category: '+category+' crawled. '+cat.numSubCategories+' subcategories discovered.');
  }

  // args: none
  // out: fetches all subcategories for each category
  async fetchAllSubCategories() {
    const categories = await Object.keys(this.categories);
    var i;
    for (i = 0; i < categories.length; i++) {
      await this.fetchSubCategories(categories[i]);
    }
    await this.setSuccessFetchCategories()
  }

  //// YOU ARE HERE
  // want %(subcat link points to products) for each cat
  // want numSubCat for Crawler
  // want %(successSubcatLinks points to products) for crawler

  // args: subcategory name, number products desired
  // out: adds links subcategory.productLinks
  async fetchProducts(subcategory, n) {

  }

  async crawlProduct(category, subcategory, url) {

  }

  async crawlSubCategory(category, subcategory, n) {

  }

  async crawlCategory(category, n) {

  }

  async crawlAll(n) {

  }


  //set methods
  setStartURL(url) {
    this.startURL = url;
  }
  setSuccessFetchCategories() {
    const categories = Object.values(this.categories);
    var numSuccess = 0
    var i;
    for (i = 0; i < categories.length; i++) {
      if (categories[i].numSubCategories > 0) {
        numSuccess++;
      }
    }
    this.successFetchCategories = (numSuccess / this.numCategories);
  }

  // get methods
  getCategories() {
    return this.categories;
  }
  getStartURL() {
    return this.startURL;
  }
  getNumCategories() {
    return this.numCategories;
  }
  getSuccessFetchCategories() {
    return this.successFetchCategories;
  }
}

// represents a category page pointing to subCateogry listings
class Category {
  constructor(name, url) {
    this.name = name;
    // url => result of chosing category in homepage search bar drop down menu and entering an empty string as search term
    this.url = url;
    // {'name of subCategory': SubCategory object}
    this.subCategories = {};
    this.numSubCategories = 0;
  }

  // get methods
  getName() {
    return this.name;
  }
  getURL() {
    return this.url;
  }
  getSubCategories() {
    return this.subCategories;
  }
  getNumSubCategories() {
    return this.numSubCategories;
  }
}

// represents a listing page containing products
class SubCategory {
  constructor(name, category, url) {
    this.name = name;
    this.category = category;
    this.url = url;
    this.numLinks = 0
    this.numProducts = 0;
    // array of fetched product links
    this.productLinks = [];
    // array of products crawled from product links
    this.products = [];
  }

  // get methods
  getName() {
    return this.name;
  }
  getURL() {
    return this.url;
  }
  getProducts() {
    return this.products;
  }
  getProductLinks() {
    return this.productLinks;
  }
  getNumLinks() {
    return this.numLinks;
  }
  getNumProducts() {
    return this.numProducts;
  }
}

// represents a product
class Product{
  constructor(catName, subCatName, url) {
    this.category = catName;
    this.subCategory = subCatName
    this.sourceURL = url;
    this.name = '';
    this.id = '';
    this.listPrice = 0;
    this.description = '';
    this.productDimensions = '';
    this.imageURLs = [];
    this.weight = '';
  }

  // set methods
  setName(name) {
    this.name = name;
  }
  setID(id) {
    this.id = id;
  }
  setListPrice(price) {
    this.listPrice = price;
  }
  setDescription(desc) {
    this.description = desc;
  }
  setProductDimensions(dims) {
    this.productDimensions = dims;
  }
  addImageURL(url) {
    this.imageURLs.push(url);
  }
  setWeight(w) {
    this.weight = w;
  }

  // get methods
  getName() {
    return this.name;
  }
  getCategory() {
    return this.category;
  }
  getSubCategory() {
    return this.subCategory;
  }
  getID() {
    return this.id;
  }
  getURL() {
    return this.sourceURL;
  }
  getListPrice() {
    return this.listPrice;
  }
  getDescription() {
    return this.description;
  }
  getProductDimensions() {
    return this.productDimensions;
  }
  getImageURLs() {
    return this.imageURLs;
  }
  getWeight() {
    return this.weight;
  }
}

async function main() {
  // create crawler object
  const amazon = await new Crawler('https://www.amazon.com');
  // fetch categories
  await amazon.fetchCategories(['All Departments','Clothing, Shoes & Jewelry']);
  // fetch all subcategories
  await amazon.fetchAllSubCategories();
  //
  const percentSuccess = await amazon.getSuccessFetchCategories();
  const categories = await amazon.getCategories();
  console.log('\n\n\n\n\n');
  console.log(categories);
  console.log('\n\n\n\n\n');
  console.log(percentSuccess);
  console.log('\n\n\n\n\n');


}

main().catch((err) => {
  console.log('\n'+err+'\n');
  return -1;
});





// const categories = await amazon.getCategories();
// console.log('\n'+amazon.getNumCategories()+'\n');
// console.log(categories);

// await amazon.fetchSubCategories('Books');
// // get books category
// const books = await amazon.getCategories()['Books'];
// console.log('\n'+books.getNumSubCategories()+'\n');
// console.log(books.getSubCategories());
// console.log('\n\n\n\n\n\n');
