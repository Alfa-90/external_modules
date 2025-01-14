odoo.define('telesale.models', function (require) {
"use strict";

var Backbone = window.Backbone;
var Model = require('web.DataModel');
var core = require('web.core');
var time = require('web.time');
var DB = require('telesale.db');
var _t = core._t;

var exports = {};


var my_round = function(number, decimals){
        if (!decimals){
            decimals = 2;
        }
        var n = number || 0;
        if (typeof n === "string"){
            n = n * 1;
        }
        return n.toFixed(decimals) * 1
}

var TsModel = Backbone.Model.extend({
    initialize: function(session, attributes) {
    Backbone.Model.prototype.initialize.call(this, attributes);
        var  self = this;
        this.session = session;  // openerp session
        this.ready = $.Deferred(); // used to notify the GUI that the PosModel has loaded all resources
        this.ready2 = $.Deferred(); // used to notify the GUI that thepromotion has writed in the server
        this.ready3 = $.Deferred(); // used to notify the GUI that tsavecurrentorder is finished
        // this.flush_mutex = new $.Mutex();  // used to make sure the orders are sent to the server once at time
        this.db = new DB.TS_LS();                       // a database used to store the products and categories
        // this.db.clear('products','partners');
        this.ts_widget = attributes.ts_widget;
        this.last_sale_id = false; // last id writed
        this.set({
            'currency':              {symbol: $, position: 'after'},
            'shop':                  null,
            'user':                  null,
            'company':               null,
            'orders':                new OrderCollection(),
            'products':              new ProductCollection(),
            'sold_lines':            new SoldLinesCollection(),
            'product_search_string': "",
            'products_names':        [], // Array of products names
            'products_codes':        [], // Array of products code

            'taxes':                  null,
            'ts_session':             null,
            'ts_config':              null,
            'units':                  [], // Array of units
            'units_names':            [], // Array of units names
           
            'customer_names':            [], // Array of customer names
            'company_customer_names':            [], // Array of customer names
            'pricelist_names':            [], // Pricelist names
            'country_names':            [], // Country names
            'state_names':            [], // State names
            'customer_codes':         [], // Array of customer refs

            'pricelist':              null,
            'selectedOrder':          null,
            'nbr_pending_operations': 0,

            'update_catalog': 'a',  //value to detect changes between a and b to update the catalog only when click in label
            'bo_id': 1 //it's a counter to assign to the buttons when you do click on '+'
        });

        this.get('orders').bind('remove', function(){ self.on_removed_order(); });
        $.when(this.load_server_data())
            .done(function(){
                self.ready.resolve();

            }).fail(function(){
                self.ready.reject();
            });
    },
    // helper function to load data from the server
    fetch: function(model, fields, domain, ctx){
        this._load_progress = (this._load_progress || 0) + 0.05;
        this.ts_widget.loading_message(_t('Loading')+' '+model,this._load_progress);
        return new Model(model).query(fields).filter(domain).context(ctx).all()
    },
    fetch_limited_ordered: function(model, fields, domain, limit, orderby, ctx){
        return new Model(model).query(fields).filter(domain).limit(limit).order_by(orderby).context(ctx).first()
    },
    fetch_ordered: function(model, fields, domain, orderby, ctx){
        return new Model(model).query(fields).filter(domain).order_by(orderby).context(ctx).all()
    },
    _get_product_fields: function(){
        return  ['display_name', 'default_code', 'uom_id', 'barcode']
    },
    _get_partner_fields: function(){
        return  ['parent_id', 'country_id', 'display_name', 'name', 'ref', 'phone', 'user_id','comment','email', 'zip', 'street', 'state_id', 'country_id', 'vat', 'write_date', 'commercial_partner_name', 'city', 'comercial', 'company_type']
    },
    // loads all the needed data on the sever. returns a deferred indicating when all the data has loaded.
    // OVERWRITED IN MODULE TELESALE MANAGE VARIANTS because dificult to inherit because of the deferred return
    load_server_data: function(){
        var self=this;

        var loaded = self.fetch('res.users',['name','company_id'],[['id', '=', this.session.uid]])
            .then(function(users){
                self.set('user', users[0]);
                    // COMPANY
                return self.fetch('res.company',
                [
                    'currency_id',
                    'name',
                    'phone',
                    'partner_id',
                    'country_id'
                ],
                [['id','=',users[0].company_id[0]]]);
                }).then(function(companies){
                    self.set('company',companies[0]);

                    // UNITS
                    return self.fetch('product.uom', ['name'], []);
                }).then(function(units){
                    for (var key in units){
                        self.get('units_names').push(units[key].name)
                    }

                    self.db.add_units(units);
                    console.time('Test performance products');

                    // PRODUCTS
                    var product_fields = self._get_product_fields();
                    var model = new Model('product.product');
                    return model.call("fetch_product_data",[product_fields, [['sale_ok', '=', true]]]);
                }).then(function(products){
                    // TODO OPTIMIZAR
                    self.db.add_products(products);
                    var products_list = [];
                    var search_string = ""
                    for (var key in products){
                        var product_obj = self.db.get_product_by_id(products[key].id)
                         products_list.push(product_obj);
                         search_string += self.db._product_search_string(product_obj)
                         self.get('products_names').push(product_obj.display_name);
                         self.get('products_codes').push(product_obj.default_code);
                    }
                    self.set('product_search_string', search_string)
                    self.get('products').reset(products_list)

                    // PARTNERS
                    var partner_fields = self._get_partner_fields();
                    return self.fetch('res.partner', partner_fields, ['|', ['customer', '=', true], ['type', '=', 'delivery']])
                }).then(function(customers){
                    for (var key in customers){
                        var customer = customers[key];
                        var customer_name = self.getComplexName(customer);
                        self.get('customer_names').push(customer_name);
                        if (customer.company_type == 'company'){
                            self.get('company_customer_names').push(customer_name);
                        }
                        self.get('customer_codes').push(customers[key].ref);
                    }
                    self.db.add_partners(customers);

                    // TAXES
                    return self.fetch('account.tax', ['amount', 'price_include', 'amount_type'], [['type_tax_use','=','sale']]);
                }).then(function(taxes) {
                    self.set('taxes', taxes);
                    self.db.add_taxes(taxes);

                    // FISCAL POSITION TAX
                    return self.fetch('account.fiscal.position.tax', ['position_id', 'tax_src_id', 'tax_dest_id']);
                }).then(function(fposition_map) {
                    self.db.add_taxes_map(fposition_map);

                    // FISCAL POSITION
                    return self.fetch('account.fiscal.position', ['name', 'tax_ids']);
                }).then(function(fposition) {
                    self.db.add_fiscal_position(fposition);

                    //PRICELIST
                    return self.fetch('product.pricelist', ['name'], ['|', ['company_id', '=', self.get('company').id], ['company_id', '=', false]]);
                }).then(function(pricelists) {
                    for (var key in pricelists){
                        var pricelist_name = pricelists[key].name;
                        self.get('pricelist_names').push(pricelist_name);
                    }
                    self.db.add_pricelist(pricelists);

                    //STATES
                    return self.fetch('res.country.state', ['name']);
                }).then(function(states) {
                    for (var key in states){
                        var state_name = states[key].name;
                        self.get('state_names').push(state_name);
                    }
                    self.db.add_states(states);
                    return self.fetch('res.country', ['name']);
                }).then(function(countries) {
                    for (var key in countries){
                        var country_name = countries[key].name;
                        self.get('country_names').push(country_name);
                    }
                    self.db.add_countries(countries);
                })
        return loaded;
    },
    load_new_partners: function(){
        var self = this;
        var def  = new $.Deferred();
        // var fields = _.find(this.models,function(model){ return model.model === 'res.partner'; }).fields;
        var partner_fields = self._get_partner_fields();
        self.fetch('res.partner', partner_fields, [['customer','=',true],['write_date','>', self.db.get_partner_write_date()]])

        // TODO MEJOR CON FETCH
        new Model('res.partner')
            .query(partner_fields)
            .filter([['customer','=',true],['write_date','>',this.db.get_partner_write_date()]])
            .all({'timeout':3000, 'shadow': true})
            .then(function(partners){
                if (self.db.add_partners(partners)) {   // check if the partners we got were real updates
                    def.resolve();
                } else {
                    def.reject();
                }
            }, function(err,event){ event.preventDefault(); def.reject(); });    
        return def;
    },
    // return the current order
    get_order: function(){
        return this.get('selectedOrder');
    },
    getCurrentDateStr: function() {
        var date = new Date();
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = date.getFullYear();
        if (month < 10) month = "0" + month;
        if (day < 10) day = "0" + day;

        var today = year + "-" + month + "-" + day;
        return today;
    },

    add_new_order: function(){
        var order = new Order({ts_model:this});
        this.get('orders').add(order);
        this.set('selectedOrder', order);
    },
    on_removed_order: function(removed_order){
        if( this.get('orders').isEmpty()){
            this.add_new_order();
        }else{
            this.set({ selectedOrder: this.get('orders').last() });
        }
    },
    push_order: function(record) {
        this.db.add_order(record);
        this.flush();
    },
    cancel_order: function(erp_id){
        var self = this;
        // (new Model('sale.order')).call('cancel_order_from_ui',,undefined,{shadow:true})
        (new Model('sale.order')).call('cancel_order_from_ui', [[erp_id]])
            .fail(function(unused, event){
                //don't show error popup if it fails
                console.error('Failed to cancel order:',erp_id);
            })
            .done(function(){
                //remove from db if success
                self.get('selectedOrder').destroy(); // remove order from UI
            });
    },
    flush: function() {
        this._flush(0);
    },
    // attempts to send an order of index 'index' in the list of order to send. The index
    // is used to skip orders that failed.
    _flush: function(index) {
        var self = this;
        var orders = this.db.get_orders();
        self.set('nbr_pending_operations',orders.length);
        var order  = orders[index];
        if(!order){
            return;
        }
        self.ready2 = $.Deferred();
        //try to push an order to the server
        // shadow : true is to prevent a spinner to appear in case of timeout
        (new Model('sale.order')).call('create_order_from_ui',[[order]])
            .fail(function(unused, event){
                //don't show error popup if it fails
                console.error('Failed to send order:',order);
                self._flush(index+1);
                self.ready2.reject();
                self.last_sale_id = false
            })
            .done(function(orders){
                //remove from db if success
                self.db.remove_order(order.id);
                self._flush(index);
                self.get('selectedOrder').destroy(); // remove order from UI
                self.last_sale_id = orders[0]
                self.ready2.resolve()
            });
    },
     _flush2: function(record) {
        var self = this;
        var last_id = self.db.load('last_order_id',0);
        var order = {id: last_id + 1, data: record};
        self.set('nbr_pending_operations',orders.length);
        if(!order){
            return;
        }
        self.ready2 = $.Deferred();
        //try to push an order to the server
        // shadow : true is to prevent a spinner to appear in case of timeout
        (new Model('sale.order')).call('create_order_from_ui',[[order]],{})
            .fail(function(unused, event){
                alert('Ocurrió un fallo en al mandar el pedido al servidor');
                self.ready2.reject()
                self.last_sale_id = false
            })
            .done(function(orders){
                //remove from db if success
                self.get('selectedOrder').destroy(); // remove order from UI
                self.last_sale_id = orders[0]
                self.ready2.resolve()
            });
    },
    // Build a order loaded from the server as order_obj the selected order_model
    get_line_vals: function(line, order_model){
        var prod_obj = this.db.get_product_by_id(line.product_id[0]);
        var vals = {
            ts_model: this, order:order_model,
            code:prod_obj.default_code || "" ,
            product:prod_obj.display_name,
            unit:line.product_uom[1],
            qty:line.product_uom_qty,
            pvp:my_round(line.price_unit,2), //TODO poner precio del producto???
            total: my_round(line.product_uom_qty * line.price_unit * (1 - line.discount /100)),
            discount: my_round(line.discount, 2) || 0.0,
            taxes_ids: line.tax_id || [],
            standard_price: line.standard_price || 0.0
        }
        return vals
    },
 
    build_order_create_lines: function(order_model, order_lines){
        for (var key in order_lines){
            var line = order_lines[key];
            var prod_obj = this.db.get_product_by_id(line.product_id[0]);
            if (!prod_obj){
                alert('Ocurrió un error al cargar el producto ' + line.product_id[1] + ' Seguramente esté desactivado. No se cargará ninguna línea ni se podrá operar con el pedido en televenta.');
                break;
            }
            var line_vals = this.get_line_vals(line, order_model)
            var line = new Orderline(line_vals);
            order_model.get('orderLines').add(line);
        }
    },
    build_order: function(order_obj, order_model, order_lines){
        var partner_obj = this.db.get_partner_by_id(order_obj.partner_id[0]);
        var cus_name = this.getComplexName(partner_obj);
        order_model.set('partner', cus_name);
        order_model.set('partner_code', partner_obj.ref || "");
        // order_model.set('customer_debt', my_round(partner_obj.credit,2));
        // order_model.set('limit_credit', my_round(partner_obj.credit_limit,2));
        order_model.set('erp_id', order_obj.id);
        order_model.set('erp_state', order_obj.state);
        var state = order_obj.state
        order_model.set('state', state);
      
        if (order_obj.requested_date){
            var only_date = order_obj.requested_date.split(' ');
            if(only_date.length > 1){
              order_model.set('requested_date', only_date[0]);
            }else {
              order_model.set('requested_date', order_obj.requested_date);
            }
        }
        order_model.set('num_order',order_obj.name);
        // TODO SACARLO DEL CLIENTE
        order_model.set('observations',order_obj.observations || '');
        order_model.set('comercial', order_obj.user_id ? order_obj.user_id[1] : "");
        order_model.set('coment',order_obj.note || '');
        order_model.set('client_order_ref',order_obj.client_order_ref || '');

        var partner_shipp_obj = this.db.get_partner_by_id(order_obj.partner_shipping_id[0]);
        var shipp_addr = this.getComplexName(partner_shipp_obj);
        order_model.set('shipp_addr',shipp_addr);

        var pricelist_obj = this.db.pricelist_by_id[order_obj.pricelist_id[0]]
        order_model.set('pricelist', pricelist_obj.name);

        this.build_order_create_lines(order_model, order_lines)
        
    },
    parse_duration_watch_format: function(minutes){
        var res = "00:00";
        if (minutes){
            var int_part = Math.floor(minutes); // integer part of minutes
            var decimal_part = minutes - int_part;
            var seconds = Math.round(decimal_part * 60);
            if (int_part < 10) int_part = "0" + int_part;
            if (seconds < 10) seconds = "0" + seconds;
            res = int_part + ":" + seconds
        }
        return res;
    },
    getCurrentFullDateStr: function() {
        var date = new Date();
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = date.getFullYear();
        var hours = date.getHours();
        var minutes = date.getMinutes();
        var seconds = date.getSeconds();
        if (month < 10) month = "0" + month;
        if (day < 10) day = "0" + day;
        if (hours < 10) hours = "0" + hours;
        if (minutes < 10) minutes = "0" + minutes;
        if (seconds < 10) seconds = "0" + seconds;

        var today = year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
        return today;
    },
    getUTCDateStr: function() {
        var date = new Date();
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = date.getFullYear();
        var hours = date.getUTCHours();
        var minutes = date.getMinutes();
        var seconds = date.getSeconds();
        if (month < 10) month = "0" + month;
        if (day < 10) day = "0" + day;
        if (hours < 10) hours = "0" + hours;
        if (minutes < 10) minutes = "0" + minutes;
        if (seconds < 10) seconds = "0" + seconds;

        var today = year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
        return today;
    },
    datetimeToStr: function(date) {
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = date.getFullYear();
        var hours = date.getHours();
        var minutes = date.getMinutes();
        var seconds = date.getSeconds();
        if (month < 10) month = "0" + month;
        if (day < 10) day = "0" + day;
        if (hours < 10) hours = "0" + hours;
        if (minutes < 10) minutes = "0" + minutes;
        if (seconds < 10) seconds = "0" + seconds;

        var today = year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
        return today;
    },
    getCurrentDateStr: function() {
        var date = new Date();
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = date.getFullYear();
        if (month < 10) month = "0" + month;
        if (day < 10) day = "0" + day;

        var today = year + "-" + month + "-" + day;
        return today;
    },
    getCurrentDatePlannedStr: function() {
        var date = new Date();
        day = date.getDay()
        add_days = 1
        if (day === 5) add_days = 3
        if (day === 6) add_days = 2
        date.setDate(date.getDate() + add_days)
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = date.getFullYear();
        if (month < 10) month = "0" + month;
        if (day < 10) day = "0" + day;

        var today = year + "-" + month + "-" + day;
        return today;
    },
    parse_str_date_to_utc: function(str_date){

        // Todo esto porque lo de abajo cambia el mes por el día, le cambiamos la fecha antes para obtener el resultado correcto
        // var str_date2 = instance.web.datetime_to_str(Date.parse(str_date)); //Se comenta porque intercambia day por month, puede que dependa de si estás en firefox o en chrome
        var str_date2 = str_date;
        var str_year = str_date2.split(" ")[0].split("-")[0]
        var str_month = str_date2.split(" ")[0].split("-")[1]
        var str_day = str_date2.split(" ")[0].split("-")[2]
        var new_str = str_year + "-" + str_month + "-" + str_day + " " + str_date2.split(" ")[1]
        return new_str
    },
    parse_utc_to_str_date: function(str_date){
        return this.datetimeToStr(time.str_to_datetime(str_date));
    },
    dateToStr: function(date) {
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = date.getFullYear();
        if (month < 10) month = "0" + month;
        if (day < 10) day = "0" + day;

        var today = year + "-" + month + "-" + day;
        return today;
    },
    localFormatDate: function(date){
        var splited =  date.split("-");
        return splited[2] + "-" +  splited[1] + "-" + splited[0];
    },
    localFormatDateTime: function(date_time){
        if (date_time){
          var splited =  date_time.split(" ");
          var date_part =  splited[0].split('-');
          var hour_part =  splited[1];
          return date_part[2] + "-" +  date_part[1] + "-" + date_part[0] + " " + hour_part;
      }
    },
    getComplexName: function(partner_obj){
        var res = '';
        if (partner_obj){
            res =  partner_obj.display_name
            if (partner_obj.ref){
                res += ' | ' + partner_obj.ref
            }
        }
        return res;
    },
    my_round: function(number, decimals){
        if (!decimals){
            decimals = 2;
        }
        var n = number || 0;
        if (typeof n === "string"){
            n = n * 1;
        }
        return n.toFixed(decimals) * 1
    },
    my_str2float: function(str){
        var res = str;
        res = res.replace(',', '.')
        if ( isNaN(res) ){
            res = 0.0;
        }
        return parseFloat(res);

    }

});

// ****************************************************************************************************************
// ******************************************** PRODUCT MODEL **************************************************
// ****************************************************************************************************************
var Product = Backbone.Model.extend({
});

var ProductCollection = Backbone.Collection.extend({
    model: Product,
});

// ****************************************************************************************************************
// ******************************************** ORDER LINE MODEL **************************************************
// ****************************************************************************************************************
var Orderline = Backbone.Model.extend({
    initialize: function(options){
        this.set({
            n_line: options.n_line || '',
            code: options.code || '',
            product: options.product || '',
            qty: options.qty || 1,
            unit: options.unit || '',
            pvp: options.pvp || 0,
            total: options.total || 0.0,
            //to calc totals
            margin: options.margin || 0,
            taxes_ids:  options.taxes_ids || [],
            discount:  options.discount ||0.0,
            standard_price: options.standard_price || 0.0
        }),
        this.ts_model = options.ts_model;
        this.order = options.order;
        this.selected = false;
    },
    set_selected: function(selected){
        this.selected = selected;
    },
    is_selected: function(){
        return this.selected;
    },
    check: function(){
        var res = true
        if ( this.get('product') == "" ) {
           res = false;
        }
        return res
    },
    get_product: function(){
        var product_obj = false
        if (this.check()){
            var product_name = this.get('product');
            var product_id = this.ts_model.db.product_name_id[product_name];
            var product_obj = this.ts_model.db.product_by_id[product_id]
        }
        return product_obj;
    },
    export_as_JSON: function() {
        var product_id = this.ts_model.db.product_name_id[this.get('product')];
        var uom_id = this.ts_model.db.unit_name_id[this.get('unit')];
        return {
            product_id:  product_id,
            qty: this.get('qty'),
            product_uom: uom_id,
            price_unit: this.get('pvp'),
            tax_ids: this.get('taxes_ids'),
            discount: this.get('discount') || 0.0,
        };
    },
    get_price_without_tax: function(){
        return this.get_all_prices().priceWithoutTax;
    },
    get_price_with_tax: function(){
        return this.get_all_prices().priceWithTax;
    },
    get_tax: function(){
        return this.get_all_prices().tax;
    },
    get_all_prices: function(){
        var self = this;
        var base = this.get('qty') * this.get('pvp') * (1 - (this.get('discount') / 100.0));
        var totalTax = base;
        var totalNoTax = base;
        var taxtotal = 0;
        var product =  this.get_product();

        if (product){
            var taxes_ids = self.get('taxes_ids')
            var taxes =  self.ts_model.get('taxes');
            var tmp;
            _.each(taxes_ids, function(el) {
                var tax = _.detect(taxes, function(t) {return t.id === el;});
                if (tax.price_include) {
                    if (tax.amount_type === "percent") {
                        tmp =  base - base / (1 + (tax.amount / 100.0));
                    } else if (tax.amount_type === "fixed") {
                        tmp = (tax.amount / 100.0) * self.get('qty');
                    } else {
                        throw "This type of tax is not supported by the telesale system: " + tax.amount_type;
                    }
                    // tmp = round_dc(tmp,2);
                    taxtotal += tmp;
                    totalNoTax -= tmp;
                } else {
                    if (tax.amount_type === "percent") {
                        tmp = (tax.amount / 100.0) * base;
                    } else if (tax.amount_type === "fixed") {
                        tmp = (tax.amount / 100.0) * self.get('qty');
                    } else {
                        throw "This type of tax is not supported by the telesale system: " + tax.amount_type;
                    }
                    // tmp = round_dc(tmp,2);
                    taxtotal += tmp;
                    totalTax += tmp;
                }
            });
        }
        return {
            "priceWithTax": my_round(totalTax,2),
            "priceWithoutTax": my_round(totalNoTax,2),
            "tax": my_round(taxtotal,2),
        };
    },
    update_line_values: function(){
        var price = this.get("pvp")
        var qty = this.get("qty")
        var disc = this.get("discount")
        var subtotal = price * qty * (1 - (disc/ 100.0))
        this.set('total',subtotal);
    },
});
var OrderlineCollection = Backbone.Collection.extend({
    model: Orderline,
});


// ****************************************************************************************************************
// ******************************************** ORDER MODEL **************************************************
// ****************************************************************************************************************
var counter = 0;
var Order = Backbone.Model.extend({
    initialize: function(attributes){
        Backbone.Model.prototype.initialize.apply(this, arguments);
        this.set({
            creationDate:   new Date(),
            orderLines:     new OrderlineCollection(),
            name:           this.generateUniqueId(),
            //order #toppart values
            num_order: this.generateNumOrder(),
            partner_code: '',
            partner: '',
            observations: '',
            shipp_addr: '',
            date_order: this.getStrDate(),
            requested_date: this.getStrDatePlanned(),
            limit_credit: (0),
            customer_debt: (0),
            //order #bottompart values
            total_discount: (0),
            total_discount_per: (0).toFixed(2)+" %",
            total_margin_per: (0).toFixed(2)+" %",
            total: (0),
            total_base: (0),
            total_iva: (0),
            total_margin: (0),
            selected_line: null,
            //to pas the button action to the server
            action_button: null,
            //to check save confirm cancel butons
            erp_id: false,
            erp_state: false,
            state:"draft",
            comercial: '',
            coment: '',
            client_order_ref: '',
            set_promotion: false,  // Used to apply promotions on server
            pricelist: '',
        });
        this.ts_model = attributes.ts_model;
        this.selected_orderline = undefined;
        this.screen_data = {};  // see ScreenSelector
        return this;
    },
    generateNumOrder: function(){
        counter += 1;
        return "TStmp "+counter
    },
    getStrDate: function() {
        var date = new Date();
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = date.getFullYear();
        if (month < 10) month = "0" + month;
        if (day < 10) day = "0" + day;

        var today = year + "-" + month + "-" + day;
        return today;
    },
     getStrDatePlanned: function() {
        var date = new Date();
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = date.getFullYear();
        if (month < 10) month = "0" + month;
        if (day < 10) day = "0" + day;

        var today = year + "-" + month + "-" + day;
        return today;
    },
    dateToStr: function(date) {
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = date.getFullYear();
        if (month < 10) month = "0" + month;
        if (day < 10) day = "0" + day;

        var today = year + "-" + month + "-" + day;
        return today;
    },
    generateUniqueId: function() {
        return new Date().getTime();
    },
    addLine: function() {
        var line = new Orderline({ts_model: this.ts_model, order:this})
        this.get('orderLines').add(line);
        return line
    },
    getSelectedLine: function(){
        var order_lines = this.get('orderLines').models;
        var res = false
        for (var key in order_lines){
            var line = order_lines[key];
            if (line.is_selected())
                res = line;
        }
        return res
    },
    removeLine: function(){
        var index = 0;
        (this.get('orderLines')).each(_.bind( function(item) {
            if ( item && item.is_selected() ){
                this.get('orderLines').remove(item)
                index = item.get('n_line') - 1;
            }
        }, this));
        if ( !$.isEmptyObject( this.get('orderLines')) ){
             if (index > 0)
                index = index - 1;
            var new_line = this.get('orderLines').models[index]
            this.selectLine(new_line);
        }

    },
    selectLine: function(line){
        if(line){
            if (line !== this.selected_orderline){
                if(this.selected_orderline) {
                    this.selected_orderline.set_selected(false);
                }
                this.selected_orderline = line;
                this.set('selected_line',   this.selected_orderline );
                this.selected_orderline.set_selected(true);
            }
        }
        else{
          this.selected_orderline = undefined;
        }
    },
    getLastOrderline: function(){
        return this.get('orderLines').at(this.get('orderLines').length -1);
    },
    check: function(){
        var res = true
        if ( this.get("partner") == "" ){
            alert(_t("Partner can not be empty."));
            res = false
        }
        if ( this.get("orderLines").length == 0 ){
            alert(_t("Order lines can not be empty."));
            res = false;
        } else{
            (this.get('orderLines')).each(_.bind( function(item) {
                if ( !item.check() ){
                    alert(_t("Product can not be empty"));
                    res = false;
                }
            }, this));
        }
        return res
    },
    exportAsJSON: function() {
        var orderLines;
        orderLines = [];
        (this.get('orderLines')).each(_.bind( function(item) {
            return orderLines.push(item.export_as_JSON());
        }, this));
        return {
            lines: orderLines,
            name: this.get('num_order'),
            partner_id: this.ts_model.db.partner_name_id[this.get('partner')],
            partner_shipping_id: this.ts_model.db.partner_name_id[this.get('shipp_addr')],
            action_button: this.get('action_button'),
            erp_id: this.get('erp_id'),
            erp_state: this.get('erp_state'),
            date_order: this.get('date_order'),
            requested_date: this.get('requested_date'),
            note: this.get('coment'),
            observations: this.get('observations'),
            client_order_ref: this.get('client_order_ref'),
            set_promotion: this.get('set_promotion'),
            pricelist_id: this.ts_model.db.pricelist_name_id[this.get('pricelist')]
        };
    },
    get_last_line_by: function(period, client_id){
      var self = this;
      // TODO TODA ESTA PARTE
      var model = new Model('sale.order.line');
      var cache_sold_lines = self.ts_model.db.cache_sold_lines[client_id]
      if (cache_sold_lines && period == 'year'){
          self.ts_model.get('sold_lines').reset(cache_sold_lines)
      }
      else{
          var loaded = model.call("get_last_lines_by",[period, client_id])
              .then(function(order_lines){
                      if (!order_lines){
                        order_lines = []
                      }
                      if(period == 'year'){
                          self.ts_model.db.cache_sold_lines[client_id] = order_lines;
                      }
                      self.ts_model.get('sold_lines').reset(order_lines)
              });
            return loaded
      }
    },
    add_lines_to_current_order: function(order_lines, fromsoldprodhistory){
        this.get('orderLines').unbind();  //unbind to render all the lines once, then in OrderWideget we bind again
        if(this.selected_orderline && this.selected_orderline.get('code') == "" && this.selected_orderline.get('product') == "" ){
          $('.remove-line-button').click()
        }
        for (var key in order_lines){
            var line = order_lines[key];
            var prod_obj = this.ts_model.db.get_product_by_id(line.product_id[0]);
            if  (!prod_obj){
              alert(_t('This product can not be loaded, becouse is not registerd'))
              return
            }
            var current_olines = this.get('orderLines').models
            for (var key2 in current_olines){
                var o_line = current_olines[key2];
                var line_product_id =  this.ts_model.db.product_name_id[o_line.get('product')];
            }
            var l_qty = line.product_uom_qty
            if(fromsoldprodhistory){
              l_qty = 1.0;
            }
            var uom_obj = this.ts_model.db.get_unit_by_id(prod_obj.uom_id)
            var line_vals = {ts_model: this.ts_model, order:this,
                             code:prod_obj.default_code || "" ,
                             product:prod_obj.display_name,
                             unit:uom_obj.name || line.product_uom[1], 
                             qty:my_round(l_qty),
                             pvp: my_round(line.current_pvp ? line.current_pvp : 0, 2),
                             total: my_round(line.product_uom_qty * line.price_unit * (1 - line.discount /100)),
                             discount: my_round( line.discount || 0.0, 2 ),
                             taxes_ids: line.tax_id || [],
                             standard_price: line.standard_price || 0.0
                            }
            var line = new Orderline(line_vals);
            this.get('orderLines').add(line);
        }
        $('.col-product').focus(); //si no, al añadir línea desde resumen de pedidos, no existe foco y si añade más líneas da error
    },
    deleteProductLine: function(id_line){
      var self=this;
      // self.get('orderLines')
    },
    createNewLine: function(vals){

    },
    addProductLine: function(product_id, add_qty, force_new_line){
        var self=this;
        if (!add_qty){
            add_qty = 1.0
        }
        if (!force_new_line){
            force_new_line = false;
        }           
        if($('#partner').val()){
            if(this.selected_orderline && !force_new_line && this.selected_orderline.get('product') == "" ){
              $('.remove-line-button').click()
            }
            $('.add-line-button').click()
            var added_line = self.ts_model.get('selectedOrder').getLastOrderline();
            var lines_widgets = self.ts_model.ts_widget.new_order_screen.order_widget.orderlinewidgets
            lines_widgets[lines_widgets.length - 1].call_product_id_change(product_id, add_qty)
        }
        else{
            alert(_t('Please select a customer before adding a order line'));
        }
    },
    get_client: function(){
        var partner_name = this.get('partner')
        var partner_obj = this.ts_model.db.partner_name_id[partner_name]
        return partner_obj
    },
    set_client: function(partner){
        var cus_name = self.ts_model.getComplexName(partner);
        this.set('partner', cus_name);
    },
    get_parent_partner: function(){
        var parent_name = ''
        var current_partner_id = this.get_client()
        var current_partner = this.ts_model.db.get_partner_by_id(current_partner_id)
        var top_parent = false;
        if (!current_partner)
            return parent_name

        if (!current_partner.parent_id) 
            return parent_name

        var parent_id = current_partner.parent_id[0]
        var parent = this.ts_model.db.get_partner_by_id(parent_id)
        while (parent){
            top_parent = parent
            parent_id = parent.parent_id || false
            parent = this.ts_model.db.get_partner_by_id(parent_id)
        }
        if (top_parent)
            parent_name = top_parent.name
        
        
        return parent_name
    }

});

var OrderCollection = Backbone.Collection.extend({
    model: Order,
});

 //**************************** SOLD LINES AND SOLD LINESCOLLECTION***********************************************
var SoldLines = Backbone.Model.extend({
    });

var SoldLinesCollection = Backbone.Collection.extend({
        model: SoldLines,
    });
exports = {
    Order: Order,
    TsModel: TsModel,
    Orderline: Orderline
}; 
return exports;
});


