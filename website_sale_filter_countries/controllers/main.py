# -*- coding: utf-8 -*-
#
# © 2016 Comunitea
# © 2019 Comunitea Ruben Seijas <ruben@comunitea.com>
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo.addons.website_sale.controllers.main import WebsiteSale
from odoo.http import request
from odoo import SUPERUSER_ID


class WebsiteSaleFilterCountry(WebsiteSale):

    def checkout_values(self, data=None):
        cr, uid, context, registry = request.cr, request.uid, request.context, request.registry
        res = super(WebsiteSaleFilterCountry, self).checkout_values(data)
        orm_country = registry.get('res.country')
        country_ids = orm_country.search(cr, SUPERUSER_ID, [('website_available', '=', True)], context=context)
        countries = orm_country.browse(cr, SUPERUSER_ID, country_ids, context)
        res['countries'] = countries

        orm_state = registry.get('res.country.state')
        state_ids = orm_state.search(cr, SUPERUSER_ID, [('website_available', '=', True)], context=context)
        states = orm_state.browse(cr, SUPERUSER_ID, state_ids, context)
        res['states'] = states
        return res
